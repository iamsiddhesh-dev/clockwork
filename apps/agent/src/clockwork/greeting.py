"""How every client-facing message the agent drafts opens.

A pitch went out for approval opening "Hi NOPE," -- the Hacker News
username of whoever posted the job, used as if it were their name. The
same data would have made a later payment reminder open "Hi Squoosh.AI |
Full-Stack Engineer (full-time, REMOTE)", because a pitched deal's contact
falls back to the posting's title. Nothing had ever decided whether a
value was a person's name: every draft passed along whatever string it
had and asked the model to be sensible.

So it is decided here, in code, once, for pitches, replies, quotes and
payment reminders alike -- the same way this project already takes money
arithmetic and the approval gate away from the model:

- `greeting_name` says whether a value is a first name worth greeting
  someone by. It is deliberately conservative. "Hi there," to a real
  person is merely neutral; a wrong name tells the reader that nobody
  looked.
- `apply_greeting` corrects the draft after the model writes it, so a
  model that ignores the instruction still cannot open with the wrong
  name.
"""

import re

#: The opening used when no trustworthy first name is known.
NEUTRAL_GREETING = "Hi there,"

#: Words that look like names by shape but are job-board furniture.
_NOT_NAMES = {
    "admin", "anonymous", "careers", "client", "company", "contact", "customer",
    "founder", "hiring", "hr", "info", "jobs", "manager", "none", "null", "owner",
    "recruiter", "recruiting", "remote", "sir", "madam", "staff", "support",
    "talent", "team", "there", "unknown", "user", "hello", "hi",
}

#: Characters no person's name contains, but usernames, companies and job
#: titles do: "Squoosh.AI", "whoishiring", "throwaway_2026", "Acme | Backend".
_NOT_NAME_CHARS = set("0123456789|@/\\:;()[]{}<>#*_=+~.,!?&%$\"")


def _looks_like_name_word(word: str) -> bool:
    """One capitalised word made of letters, allowing Mary-Jane and O'Neil.

    Shape does most of the work: all-lowercase ("tptacek") and all-caps
    ("NOPE") are how usernames are written, and neither is how anyone
    types their own name into a form.
    """
    letters = word.replace("-", "").replace("'", "").replace("’", "")
    if len(letters) < 2 or not letters.isalpha():
        return False
    if not word[0].isupper():
        return False
    if word.isupper():
        return False
    return word.lower() not in _NOT_NAMES


def greeting_name(raw: str | None) -> str | None:
    """The first name to greet someone by, or None when there isn't a
    trustworthy one."""
    if not raw:
        return None
    value = " ".join(str(raw).split())
    if not value or len(value) > 40 or "http" in value.lower():
        return None
    if any(ch in _NOT_NAME_CHARS for ch in value):
        return None
    words = value.split(" ")
    if len(words) > 4 or not all(_looks_like_name_word(w) for w in words):
        return None
    return words[0]


#: Threads that began as our outbound pitch. Their stored contact is the
#: posting's author or title -- a username or a company, never something a
#: person told us they are called -- so nothing on them is greeted by name.
UNNAMED_CHANNELS = {"outbound_pitch"}


def thread_greeting_source(thread: dict | None) -> str | None:
    """The name a message on this thread may greet, before `greeting_name`
    judges it. None for a thread whose contact was never a person's name.

    Shape alone can't tell "Acme Labs" from "Maya Okonkwo", so where the
    value came from decides first: a name typed into the intake form is
    worth checking, a job board's author field never is.
    """
    if not thread or thread.get("channel") in UNNAMED_CHANNELS:
        return None
    name = thread.get("contact_name")
    # People type their own name into a form in lowercase all the time, and
    # lowercase is otherwise the strongest sign of a username. The field's
    # provenance settles it here: it asked for a name, so treat it as one.
    if name and thread.get("channel") == "intake_form" and name.islower():
        name = name.title()
    return name


def greeting_line(raw: str | None) -> str:
    """The exact opening line a draft must use: "Hi Maya," or "Hi there,"."""
    name = greeting_name(raw)
    return f"Hi {name}," if name else NEUTRAL_GREETING


def greeting_instruction(raw: str | None) -> str:
    """The rule appended to every client-facing prompt."""
    line = greeting_line(raw)
    return (
        f"Open the message with exactly this greeting: {line!r}. Do not address the "
        "recipient by any other name -- not a username, not a company, not a job "
        "title. NEVER write a bracketed placeholder like [Client], [Name] or "
        "[Your name]: this text goes out exactly as written, with nothing filled "
        "in afterwards."
    )


# A salutation at the very start of a draft: "Hi NOPE,", "Hello Squoosh.AI
# team -", "Dear [Client]:", "Hey there!". The name part is bounded and
# may not cross a line, so the rule never swallows the first sentence of
# a message that simply has no greeting.
_SALUTATION = re.compile(
    r"^\s*(?:hi|hello|hey|dear|greetings)\b(?P<name>[^\n,!:;—–-]{0,60}?)\s*[,!:;—–-]+[ \t]*",
    re.IGNORECASE,
)


# What a model tacks on after "Hi there,": the job title or company it was
# told not to use -- "Hi there, AI Engineer, Agent Builder. I built...".
# Only a run of two to six capitalised words before the first full stop,
# "!" or line end counts. A real opening sentence ("Thanks for the
# post.", "I built...") has a lowercase word in it, and one that starts
# with "I" is the sender talking about themselves, so both are kept.
# The addressee may sit on the greeting's line or start the next one
# ("Hi there,\nFull-Stack Engineer – I built..."). A dash only ends it when
# spaced, so the hyphen inside "Full-Stack" stays part of the title.
_ADDRESSEE = re.compile(
    r"^(?P<lead>\s*)(?P<words>[^\n.!?:;]{1,60}?)(?:[ \t]*[.!:;]+|[ \t]+[—–‑-]+)[ \t]*"
)
_JOINERS = {"and", "&", "of", "the", "at"}
_SELF = re.compile(r"^I(?:'|’|$)")


def _strip_addressee(rest: str) -> str:
    match = _ADDRESSEE.match(rest)
    if not match:
        return rest
    words = re.findall(r"[^\s,]+", match.group("words"))
    if not 2 <= len(words) <= 6 or _SELF.match(words[0]):
        return rest
    if not all(w[0].isupper() or w.lower() in _JOINERS for w in words):
        return rest
    return match.group("lead") + rest[match.end():]


def apply_greeting(body: str, raw_name: str | None) -> str:
    """Make the draft open with the right greeting, whatever the model wrote.

    Only a greeting the model actually wrote is rewritten. A draft with no
    salutation is left alone rather than having one bolted on, because some
    client-facing text -- a quote's covering note -- reads better without.
    """
    if not body:
        return body
    match = _SALUTATION.match(body)
    if not match:
        return body
    line = greeting_line(raw_name)
    rest = _strip_addressee(body[match.end():])
    # Keep the draft's own layout: a greeting on its own line stays on its
    # own line, one that ran straight into the first sentence still does.
    separator = "" if rest.startswith("\n") or not rest else " "
    return f"{line}{separator}{rest}"

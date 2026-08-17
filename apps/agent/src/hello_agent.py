"""
Minimal Strands hello-world agent, wired to Amazon Bedrock (Claude Sonnet 5).

Purpose: verify the local environment can reach Bedrock and get a real
response back, before building any real Clockwork tools on top of it.

Prerequisites (see README / PLAN.md for details):
  - AWS credentials configured locally (`aws configure`), for an IAM user
    with Bedrock invoke permissions.
  - Bedrock model access approved for Claude Sonnet 5 in us-east-1
    (global cross-region inference profile).

Run:
    python src/hello_agent.py

Until quota is approved, this will fail with an access/throttling error
from Bedrock itself -- that's expected, and actually a good sign, since
it means the request correctly reached Bedrock and was only blocked by
the pending quota, not by a bug in this script.
"""

from strands import Agent
from strands.models import BedrockModel

# Global cross-region inference profile -- routes across the widest pool
# of regions for best availability. See PLAN.md's model routing table for
# why Sonnet 5 is used here for internal reasoning only, never
# client-facing text (that's Nova Pro's job).
model = BedrockModel(
    model_id="global.anthropic.claude-sonnet-5",
    region_name="us-east-1",
    temperature=0.3,
)

agent = Agent(model=model)


def main() -> None:
    result = agent(
        "Say hello, confirm which model you are, and confirm you're "
        "running via Amazon Bedrock."
    )
    print(result)


if __name__ == "__main__":
    main()

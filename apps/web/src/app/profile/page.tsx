import { redirect } from "next/navigation";

/** Profile folded into Settings when the nav was cut to seven items.
 *  Kept as a redirect so older links and bookmarks still land somewhere. */
export default function ProfilePage() {
  redirect("/settings");
}

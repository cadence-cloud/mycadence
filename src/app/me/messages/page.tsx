import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { messageReads } from "@/db/schema";
import { requirePageUser } from "@/server/session";
import { careTeam, patientIdForUser } from "@/server/authz";
import { listMessages, markRead, threadFor } from "@/server/messaging";
import { getSettings } from "@/server/settings";
import { patientSendMessage } from "@/app/actions/patient";
import { Card, Notice } from "@/components/ui";
import { MessageForm } from "@/components/forms";
import { MessageThread } from "@/components/message-thread";

export default async function MyMessages() {
  const user = await requirePageUser(["patient"]);
  const db = await getDb();
  const pid = (await patientIdForUser(db, user.id))!;
  const thread = await threadFor(db, pid);
  const [msgs, team, settings, [read]] = await Promise.all([
    listMessages(db, thread.id),
    careTeam(db, pid),
    getSettings(db),
    db.select().from(messageReads).where(and(eq(messageReads.threadId, thread.id), eq(messageReads.userId, user.id))).limit(1),
  ]);
  await markRead(db, thread.id, user.id);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Messages</h1>
        <p className="text-sm text-muted">
          Your care team: {team.map((t) => `${t.name}${t.role === "covering" ? " (covering)" : ""}`).join(", ") || "not assigned yet"}
        </p>
      </div>
      <Notice tone="info">
        {settings.responseExpectation} {settings.urgentGuidance}
      </Notice>
      <Card>
        <MessageThread messages={msgs} viewerId={user.id} lastReadAt={read?.lastReadAt ?? null} />
      </Card>
      <Card>
        <MessageForm action={patientSendMessage} hidden={{}} placeholder="Write to your care team" />
      </Card>
    </div>
  );
}

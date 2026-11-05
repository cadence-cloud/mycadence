import { formatDateTime } from "@/lib/time";
import { Badge, EmptyState } from "./ui";

export interface Msg {
  id: string;
  body: string;
  createdAt: Date;
  simulated: boolean;
  senderId: string;
  senderName: string;
  senderRole: string;
  senderCredentials: string | null;
  via?: string;
}

export function MessageThread({ messages, viewerId, lastReadAt }: { messages: Msg[]; viewerId: string; lastReadAt?: Date | null }) {
  if (!messages.length) return <EmptyState title="No messages yet" body="Start the conversation below." />;
  let dividerShown = false;
  return (
    <ol className="space-y-3" aria-label="Messages">
      {messages.map((m) => {
        const mine = m.senderId === viewerId;
        const showDivider = !dividerShown && !mine && lastReadAt != null && m.createdAt > lastReadAt;
        if (showDivider) dividerShown = true;
        return (
          <li key={m.id}>
            {showDivider && (
              <div className="my-2 flex items-center gap-2 text-xs font-semibold text-pine-800">
                <span className="h-px flex-1 bg-lime-400" /> New <span className="h-px flex-1 bg-lime-400" />
              </div>
            )}
            <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${mine ? "bg-pine-900 text-white" : "border border-sand-200 bg-white"}`}>
                <p className={`text-xs font-semibold ${mine ? "text-pine-200" : "text-muted"}`}>
                  {mine ? "You" : m.senderName}
                  {m.senderRole !== "patient" && !mine && " · Cadence"}
                </p>
                <p className="mt-0.5 whitespace-pre-line text-[15px] leading-relaxed">{m.body}</p>
                <p className={`mt-1 flex items-center gap-2 text-xs ${mine ? "text-pine-200" : "text-muted"}`}>
                  <time dateTime={m.createdAt.toISOString()}>{formatDateTime(m.createdAt)}</time>
                  {m.via === "email" && <Badge tone="blue">Replied by email</Badge>}
                  {m.simulated && <Badge tone="neutral">Simulated (demo)</Badge>}
                </p>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

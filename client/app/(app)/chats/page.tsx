import { MessageCircle } from "lucide-react";

export default function ChatsIndexPage() {
  return (
    <div className="hidden flex-1 flex-col items-center justify-center gap-3 bg-background text-center sm:flex">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft text-accent">
        <MessageCircle size={28} />
      </div>
      <div>
        <p className="font-medium">Select a conversation</p>
        <p className="text-sm text-muted">Choose a friend from the list to start chatting.</p>
      </div>
    </div>
  );
}

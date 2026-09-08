import { ChatWindow } from "@/components/chat/ChatWindow";

export default async function ChatConversationPage({
  params,
}: {
  params: Promise<{ friendId: string }>;
}) {
  const { friendId } = await params;
  return <ChatWindow friendId={friendId} />;
}

import { CodenamesClient } from "../../../components/codenames-client";

export default async function CodenamesRoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <CodenamesClient roomCode={code.toUpperCase()} />;
}

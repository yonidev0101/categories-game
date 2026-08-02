import { TabooClient } from "../../../components/taboo-client";

export default async function TabooRoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <TabooClient roomCode={code.toUpperCase()} />;
}

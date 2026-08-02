import { FamilyClient } from "../../../components/family-client";

export default async function FamilyRoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <FamilyClient roomCode={code.toUpperCase()} />;
}

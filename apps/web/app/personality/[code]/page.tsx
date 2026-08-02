import { PersonalityClient } from "../../../components/personality-client";

export default async function PersonalityRoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <PersonalityClient roomCode={code.toUpperCase()} />;
}

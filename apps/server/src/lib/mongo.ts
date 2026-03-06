import { MongoClient, type Db } from "mongodb";
import type { RoomStateSnapshot, ScoreBreakdown, ValidationLogEntry } from "@categories-game/shared";

export class MongoPersistence {
  private client: MongoClient | null = null;
  private db: Db | null = null;

  constructor(private readonly uri: string, private readonly dbName: string) {}

  async connect(): Promise<void> {
    if (!this.uri) {
      return;
    }

    try {
      this.client = new MongoClient(this.uri);
      await this.client.connect();
      this.db = this.client.db(this.dbName);

      await Promise.all([
        this.db.collection("rooms").createIndex({ code: 1 }, { unique: true }),
        this.db.collection("submissions").createIndex({ roomCode: 1, roundNumber: 1, playerId: 1 }, { unique: true }),
        this.db.collection("validationLogs").createIndex({ roomId: 1, roundNumber: 1, playerId: 1 })
      ]);
    } catch (error) {
      await this.client?.close().catch(() => undefined);
      this.client = null;
      this.db = null;
      throw error;
    }
  }

  async saveRoom(snapshot: RoomStateSnapshot): Promise<void> {
    if (!this.db) {
      return;
    }

    await this.db.collection("rooms").updateOne(
      { code: snapshot.room.code },
      {
        $set: {
          code: snapshot.room.code,
          snapshot,
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );
  }

  async saveSubmission(params: {
    roomCode: string;
    roomId: string;
    roundNumber: number;
    playerId: string;
    answers: Record<string, string>;
  }): Promise<void> {
    if (!this.db) {
      return;
    }

    await this.db.collection("submissions").updateOne(
      { roomCode: params.roomCode, roundNumber: params.roundNumber, playerId: params.playerId },
      { $set: { ...params, updatedAt: new Date() } },
      { upsert: true }
    );
  }

  async saveRoundResults(roomCode: string, roundNumber: number, scoreboard: ScoreBreakdown[]): Promise<void> {
    if (!this.db) {
      return;
    }

    await this.db.collection("rounds").updateOne(
      { roomCode, roundNumber },
      { $set: { roomCode, roundNumber, scoreboard, updatedAt: new Date() } },
      { upsert: true }
    );
  }

  async saveValidationLog(entry: ValidationLogEntry): Promise<void> {
    if (!this.db) {
      return;
    }

    await this.db.collection("validationLogs").insertOne({ ...entry, createdAt: new Date() });
  }

  async disconnect(): Promise<void> {
    await this.client?.close();
  }

  async repairRoomIndexes(): Promise<void> {
    if (!this.db) {
      return;
    }

    const rooms = this.db.collection("rooms");

    try {
      await rooms.dropIndex("room.code_1");
    } catch {
      // Ignore missing legacy index.
    }

    await rooms.deleteMany({ code: { $exists: false } });
    await rooms.createIndex({ code: 1 }, { unique: true });
  }
}



import { createClient, type RedisClientType } from "redis";

export class RedisCoordinator {
  private client: RedisClientType | null = null;

  constructor(private readonly url: string) {}

  async connect(): Promise<void> {
    if (!this.url) {
      return;
    }

    this.client = createClient({ url: this.url });
    this.client.on("error", () => undefined);
    await this.client.connect();
  }

  async publishRoomUpdate(roomCode: string, payload: unknown): Promise<void> {
    if (!this.client) {
      return;
    }

    await this.client.publish(`room:${roomCode}:updates`, JSON.stringify(payload));
  }

  async disconnect(): Promise<void> {
    await this.client?.disconnect();
  }
}



import { createClient, type RedisClientType } from "redis";

export class RedisCoordinator {
  private client: RedisClientType | null = null;

  constructor(private readonly url: string) {}

  async connect(): Promise<void> {
    if (!this.url) {
      return;
    }

    // Fail fast instead of retrying forever: Redis is optional, and a server
    // that never finishes booting is far worse than one running without it.
    this.client = createClient({
      url: this.url,
      socket: { connectTimeout: 3000, reconnectStrategy: false },
    }) as RedisClientType;
    this.client.on("error", () => undefined);

    try {
      await this.client.connect();
    } catch (error) {
      this.client = null;
      throw error;
    }
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



import { io, type Socket } from "socket.io-client";
import { getClientConfig } from "./config";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(getClientConfig().socketUrl, {
      transports: ["websocket"],
      autoConnect: false
    });
  }

  return socket;
}



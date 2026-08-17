import type { Server } from "node:http";
import { createApp } from "./app.js";

export interface MockServer {
  server: Server;
  port: number;
  baseUrl: string;
}

export async function startMockServer(port = Number(process.env.PORT ?? 3000)): Promise<MockServer> {
  const app = createApp();
  return await new Promise((resolve, reject) => {
    const server = app.listen(port, "127.0.0.1");
    server.once("listening", () => {
      const addr = server.address();
      const actual = typeof addr === "object" && addr ? addr.port : port;
      resolve({
        server,
        port: actual,
        baseUrl: `http://127.0.0.1:${actual}`,
      });
    });
    server.once("error", reject);
  });
}

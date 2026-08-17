import "dotenv/config";
import { startMockServer } from "./listen.js";

const started = await startMockServer();
console.log(`MemberCore 7.4 training region  ${started.baseUrl}/login`);

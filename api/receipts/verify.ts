import { route, type RequestLike, type ResponseLike } from "../../src/handlers.js";

export default function handler(req: RequestLike, res: ResponseLike) {
  return route(req, res, { POST: "receipt.verify" });
}

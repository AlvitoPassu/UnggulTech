import axios from "axios";
import { AI_REQUEST_TIMEOUT_MS } from "./aiRequestConfig.js";

export async function sendChatbotMessage(message) {
  const response = await axios.post("/api/chatbot", { message }, { timeout: AI_REQUEST_TIMEOUT_MS });
  return response.data;
}

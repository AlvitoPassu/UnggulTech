import axios from "axios";

export async function sendChatbotMessage(message) {
  const response = await axios.post("/api/chatbot", { message }, { timeout: 30000 });
  return response.data;
}

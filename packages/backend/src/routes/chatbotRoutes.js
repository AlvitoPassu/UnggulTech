import { Router } from "express";
import { generateChatbotReply } from "../services/chatbotService.js";

const router = Router();

router.post("/", async (req, res, next) => {
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message || message.length > 2000) {
    return res.status(400).json({ message: "Pertanyaan harus berisi maksimal 2.000 karakter." });
  }

  try {
    return res.json(await generateChatbotReply(message));
  } catch (error) {
    if (error.code === "GEMINI_NOT_CONFIGURED") {
      return res.status(503).json({ message: "Layanan AI belum dikonfigurasi." });
    }
    console.error("Chatbot request failed:", error.message || error);
    return next(error);
  }
});

export default router;

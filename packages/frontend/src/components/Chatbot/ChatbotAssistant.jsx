import { useEffect, useRef, useState } from "react";
import { FiActivity, FiCloudRain, FiDroplet, FiMessageCircle, FiRefreshCw, FiSend, FiWifi, FiX } from "react-icons/fi";
import { sendChatbotMessage } from "../../api/chatbotApi";
import ChatMessage from "./ChatMessage";

const welcomeMessage = "Halo! Saya AI Assistant UnggulMonitoring.\nSaya dapat membantu Anda menganalisis data sensor, soil moisture, kondisi nursery, dan memberikan informasi berdasarkan data yang tersedia.";
const quickActions = [
  { label: "Kondisi kelembapan tanah", question: "Bagaimana kondisi kelembapan nursery saat ini?", icon: FiDroplet },
  { label: "Analisis curah hujan", question: "Apakah curah hujan hari ini cukup untuk mengurangi kebutuhan penyiraman?", icon: FiCloudRain },
  { label: "Status penyiraman", question: "Apakah bibit perlu disiram sekarang?", icon: FiActivity },
  { label: "Data sensor terbaru", question: "Bagaimana status dan data sensor terbaru?", icon: FiWifi },
  { label: "Kondisi bibit", question: "Berikan ringkasan kondisi nursery saat ini.", icon: FiActivity },
];

const timeLabel = () => new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit" }).format(new Date());
const initialMessages = () => [{ id: "welcome", role: "assistant", content: welcomeMessage, time: timeLabel() }];

const ChatbotAssistant = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading, isOpen]);

  const sendMessage = async (value = input) => {
    const question = value.trim();
    if (!question || isLoading) return;
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", content: question, time: timeLabel() }]);
    setInput("");
    setIsLoading(true);
    try {
      const { reply } = await sendChatbotMessage(question);
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: reply, time: timeLabel() }]);
    } catch (error) {
      console.error("Chatbot error:", error);
      const message = error.response?.status === 503
        ? "Layanan AI belum dikonfigurasi. Hubungi administrator untuk menambahkan GEMINI_API_KEY di backend."
        : "Maaf, saya sedang mengalami kendala saat menghubungkan ke AI. Silakan coba lagi.";
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: message, time: timeLabel() }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed bottom-5 right-5 z-40 sm:bottom-6 sm:right-6">
      {isOpen && (
        <section className="mb-3 flex h-[min(680px,calc(100dvh-120px))] w-[calc(100vw-2.5rem)] max-w-[400px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10" aria-label="Unggul AI Assistant">
          <header className="flex items-start justify-between bg-[#1DAADF] px-4 py-3 text-white">
            <div className="flex gap-2.5"><FiMessageCircle className="mt-0.5 text-xl" aria-hidden="true" /><div><h2 className="text-sm font-bold">Unggul AI Assistant</h2><p className="text-xs text-white/85">Siap membantu dengan data nursery Anda</p></div></div>
            <button type="button" onClick={() => setIsOpen(false)} className="rounded-md p-1 transition hover:bg-white/15" aria-label="Tutup chatbot"><FiX className="text-lg" /></button>
          </header>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.map((message) => <ChatMessage key={message.id} message={message} />)}
            {messages.length === 1 && <div className="flex flex-wrap gap-2">{quickActions.map(({ label, question, icon: Icon }) => <button key={label} type="button" onClick={() => sendMessage(question)} disabled={isLoading} className="inline-flex items-center gap-1.5 rounded-full border border-[#1DAADF]/25 bg-cyan-50 px-2.5 py-1.5 text-xs font-medium text-[#1686b3] transition hover:border-[#1DAADF] hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"><Icon aria-hidden="true" />{label}</button>)}<button type="button" onClick={() => document.getElementById("unggul-chat-input")?.focus()} className="rounded-full border border-[#1DAADF]/25 bg-cyan-50 px-2.5 py-1.5 text-xs font-medium text-[#1686b3] transition hover:border-[#1DAADF] hover:bg-cyan-100">Tanya bebas</button></div>}
            {isLoading && <div className="flex items-center gap-2 text-sm text-slate-500"><FiRefreshCw className="animate-spin text-[#1DAADF]" />AI sedang menganalisis data...</div>}
            <div ref={bottomRef} />
          </div>
          <form onSubmit={(event) => { event.preventDefault(); sendMessage(); }} className="border-t border-slate-100 p-3">
            <div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 focus-within:border-[#1DAADF] focus-within:ring-2 focus-within:ring-[#1DAADF]/15"><textarea id="unggul-chat-input" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); } }} disabled={isLoading} rows="1" maxLength="2000" placeholder="Ketik pertanyaan..." className="max-h-24 min-h-5 flex-1 resize-none bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed" /><button type="submit" disabled={!input.trim() || isLoading} className="rounded-lg bg-[#1DAADF] p-2 text-white transition hover:bg-[#1686b3] disabled:cursor-not-allowed disabled:opacity-50" aria-label="Kirim pesan"><FiSend /></button></div>
            <button type="button" onClick={() => setMessages(initialMessages())} disabled={isLoading} className="mt-2 text-xs text-slate-400 transition hover:text-[#1686b3] disabled:opacity-50">Reset percakapan</button>
          </form>
        </section>
      )}
      <button type="button" onClick={() => setIsOpen((open) => !open)} className="flex h-15 w-15 items-center justify-center rounded-full bg-[#1DAADF] text-white shadow-lg shadow-[#1DAADF]/30 transition hover:scale-105 hover:bg-[#1686b3] focus:outline-none focus:ring-4 focus:ring-[#1DAADF]/25" aria-label={isOpen ? "Tutup Unggul AI Assistant" : "Buka Unggul AI Assistant"} aria-expanded={isOpen}><FiMessageCircle className="text-2xl" /></button>
    </div>
  );
};

export default ChatbotAssistant;

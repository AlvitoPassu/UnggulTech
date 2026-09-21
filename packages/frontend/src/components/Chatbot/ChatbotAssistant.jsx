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
  const messagesContainerRef = useRef(null);
  const textareaRef = useRef(null);

  const scrollToMessage = (messageId, behavior = "smooth") => {
    if (!messagesContainerRef.current) return;
    const container = messagesContainerRef.current;

    if (!messageId) {
      container.scrollTo({ top: container.scrollHeight, behavior });
      return;
    }

    const element = document.getElementById(`chat-msg-${messageId}`);
    if (!element) {
      container.scrollTo({ top: container.scrollHeight, behavior });
      return;
    }

    // Cek apakah pesan tinggi/panjang (lebih dari 50% tinggi kontainer chat)
    const isLongMessage = element.offsetHeight > container.clientHeight * 0.5;

    if (isLongMessage) {
      // Jika pesan panjang, posisikan BAGIAN ATAS pesan agar langsung terbaca dari kalimat pertama
      // Pengguna tidak perlu scroll ke atas lagi untuk membaca awal pesan!
      const targetScroll = element.offsetTop - 12;
      container.scrollTo({
        top: Math.max(0, targetScroll),
        behavior,
      });
    } else {
      // Jika pesan pendek, scroll ke bawah normal agar seluruh bubble terlihat
      container.scrollTo({
        top: container.scrollHeight,
        behavior,
      });
    }
  };

  useEffect(() => {
    if (messages.length <= 1) {
      if (messagesContainerRef.current) {
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
      }
      return;
    }

    const latestMessage = messages[messages.length - 1];
    const timer = setTimeout(() => {
      scrollToMessage(latestMessage?.id, "smooth");
    }, 60);
    return () => clearTimeout(timer);
  }, [messages]);

  useEffect(() => {
    if (isLoading && messagesContainerRef.current) {
      const timer = setTimeout(() => {
        messagesContainerRef.current.scrollTo({
          top: messagesContainerRef.current.scrollHeight,
          behavior: "smooth",
        });
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [isLoading]);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        if (messagesContainerRef.current) {
          messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Kunci total scroll background pada tampilan mobile ketika chatbot sedang terbuka
  useEffect(() => {
    if (!isOpen || typeof window === "undefined") return;

    const isMobile = window.matchMedia("(max-width: 1023px)").matches;
    if (!isMobile) return;

    const scrollY = window.scrollY || window.pageYOffset || 0;
    const originalBodyStyles = {
      position: document.body.style.position,
      top: document.body.style.top,
      left: document.body.style.left,
      right: document.body.style.right,
      width: document.body.style.width,
      overflow: document.body.style.overflow,
    };
    const originalHtmlOverflow = document.documentElement.style.overflow;

    // Freeze background secara absolut di posisi scroll saat ini
    document.documentElement.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    document.body.style.overflow = "hidden";

    return () => {
      document.documentElement.style.overflow = originalHtmlOverflow;
      document.body.style.position = originalBodyStyles.position || "";
      document.body.style.top = originalBodyStyles.top || "";
      document.body.style.left = originalBodyStyles.left || "";
      document.body.style.right = originalBodyStyles.right || "";
      document.body.style.width = originalBodyStyles.width || "";
      document.body.style.overflow = originalBodyStyles.overflow || "";
      window.scrollTo(0, scrollY);
    };
  }, [isOpen]);

  const handleInputChange = (event) => {
    setInput(event.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  };

  const sendMessage = async (value = input) => {
    const question = value.trim();
    if (!question || isLoading) return;
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", content: question, time: timeLabel() }]);
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
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
    <>
      {/* Backdrop di mobile untuk menangkap tap di luar dan mencegah sentuhan tembus ke background */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/20 backdrop-blur-[1px] lg:hidden"
          onClick={() => setIsOpen(false)}
          onTouchMove={(e) => e.preventDefault()}
          aria-hidden="true"
        />
      )}

      <div className="fixed bottom-[calc(4rem+0.75rem+env(safe-area-inset-bottom))] right-3 z-40 sm:right-6 lg:bottom-6">
        {isOpen && (
          <section
            className="mb-3 flex w-[calc(100vw-1.5rem)] max-w-[400px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/15"
            style={{
              height: "min(580px, calc(100dvh - 140px - env(safe-area-inset-bottom, 0px)))",
              maxHeight: "calc(100dvh - 130px)",
              overscrollBehavior: "contain",
            }}
            aria-label="Unggul AI Assistant"
          >
            <header
              className="flex items-start justify-between bg-[#1DAADF] px-4 py-3 text-white select-none"
              style={{ touchAction: "none" }}
              onTouchMove={(e) => e.preventDefault()}
            >
              <div className="flex gap-2.5">
                <FiMessageCircle className="mt-0.5 text-xl" aria-hidden="true" />
                <div>
                  <h2 className="text-sm font-bold">Unggul AI Assistant</h2>
                  <p className="text-xs text-white/85">Siap membantu dengan data nursery Anda</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-md p-1 transition hover:bg-white/15"
                aria-label="Tutup chatbot"
              >
                <FiX className="text-lg" />
              </button>
            </header>

            <div
              ref={messagesContainerRef}
              className="relative min-h-0 flex-1 space-y-3 overflow-y-auto p-4"
              style={{
                WebkitOverflowScrolling: "touch",
                touchAction: "pan-y",
                overscrollBehavior: "contain",
              }}
              onTouchMove={(e) => e.stopPropagation()}
            >
              {messages.map((message) => (
                <div key={message.id} id={`chat-msg-${message.id}`} className="scroll-mt-2">
                  <ChatMessage message={message} />
                </div>
              ))}
              {messages.length === 1 && (
                <div className="flex flex-wrap gap-2">
                  {quickActions.map(({ label, question, icon: Icon }) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => sendMessage(question)}
                      disabled={isLoading}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[#1DAADF]/25 bg-cyan-50 px-2.5 py-1.5 text-xs font-medium text-[#1686b3] transition hover:border-[#1DAADF] hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Icon aria-hidden="true" />
                      {label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => document.getElementById("unggul-chat-input")?.focus()}
                    className="rounded-full border border-[#1DAADF]/25 bg-cyan-50 px-2.5 py-1.5 text-xs font-medium text-[#1686b3] transition hover:border-[#1DAADF] hover:bg-cyan-100"
                  >
                    Tanya bebas
                  </button>
                </div>
              )}
              {isLoading && (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <FiRefreshCw className="animate-spin text-[#1DAADF]" />
                  AI sedang menganalisis data...
                </div>
              )}
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                sendMessage();
              }}
              className="border-t border-slate-100 bg-white p-3"
              style={{ touchAction: "none" }}
              onTouchMove={(e) => e.stopPropagation()}
            >
              <div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 focus-within:border-[#1DAADF] focus-within:ring-2 focus-within:ring-[#1DAADF]/15">
                <textarea
                  ref={textareaRef}
                  id="unggul-chat-input"
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      sendMessage();
                    }
                  }}
                  disabled={isLoading}
                  rows="1"
                  maxLength="2000"
                  placeholder="Ketik pertanyaan..."
                  className="max-h-32 min-h-[24px] flex-1 resize-none bg-transparent text-sm leading-5 text-slate-700 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed overflow-y-auto"
                  style={{ height: "auto" }}
                />
                <button
                  type="submit"
                  disabled={!input.trim() || isLoading}
                  className="mb-0.5 rounded-lg bg-[#1DAADF] p-2 text-white transition hover:bg-[#1686b3] disabled:cursor-not-allowed disabled:opacity-50 shrink-0"
                  aria-label="Kirim pesan"
                >
                  <FiSend />
                </button>
              </div>
              <button
                type="button"
                onClick={() => setMessages(initialMessages())}
                disabled={isLoading}
                className="mt-2 text-xs text-slate-400 transition hover:text-[#1686b3] disabled:opacity-50"
              >
                Reset percakapan
              </button>
            </form>
          </section>
        )}

        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-[#1DAADF] text-white shadow-lg shadow-[#1DAADF]/30 transition hover:scale-105 hover:bg-[#1686b3] focus:outline-none focus:ring-4 focus:ring-[#1DAADF]/25"
          aria-label={isOpen ? "Tutup Unggul AI Assistant" : "Buka Unggul AI Assistant"}
          aria-expanded={isOpen}
        >
          <FiMessageCircle className="text-2xl" />
        </button>
      </div>
    </>
  );
};

export default ChatbotAssistant;

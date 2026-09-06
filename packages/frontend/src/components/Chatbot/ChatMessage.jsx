const ChatMessage = ({ message }) => {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] whitespace-pre-line rounded-2xl px-3 py-2 text-sm leading-relaxed ${isUser ? "rounded-br-md bg-[#1DAADF] text-white" : "rounded-bl-md border border-slate-100 bg-slate-50 text-slate-700"}`}>
        {message.content}
        <p className={`mt-1 text-[10px] ${isUser ? "text-white/75" : "text-slate-400"}`}>{message.time}</p>
      </div>
    </div>
  );
};

export default ChatMessage;

const ChatMessage = ({ message }) => {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[90%] break-words whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "rounded-br-md bg-[#1DAADF] text-white"
            : "rounded-bl-md border border-slate-100 bg-slate-50 text-slate-700 shadow-sm"
        }`}
      >
        {message.content}
        <p className={`mt-1 text-[10px] ${isUser ? "text-white/75" : "text-slate-400"}`}>{message.time}</p>
      </div>
    </div>
  );
};

export default ChatMessage;

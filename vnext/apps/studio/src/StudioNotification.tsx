export interface StudioNotificationMessage {
  text: string;
  title?: string;
  tone: "error" | "info";
}

export function StudioNotification({
  message,
  onDismiss
}: {
  message: StudioNotificationMessage;
  onDismiss: () => void;
}) {
  const title = message.title ?? (message.tone === "error" ? "操作を完了できませんでした" : "確認してください");
  return (
    <section
      aria-atomic="true"
      aria-live={message.tone === "error" ? "assertive" : "polite"}
      className={`studio-notification is-${message.tone}`}
      role={message.tone === "error" ? "alert" : "status"}
    >
      <svg aria-hidden="true" className="studio-notification__icon" viewBox="0 0 24 24">
        {message.tone === "error" ? (
          <><path d="M12 3 2.8 20h18.4L12 3Z" /><path d="M12 9v4m0 3v1" /></>
        ) : (
          <><circle cx="12" cy="12" r="9" /><path d="M12 10v7m0-10v.5" /></>
        )}
      </svg>
      <div className="studio-notification__content">
        <strong>{title}</strong>
        <p>{message.text}</p>
      </div>
      <button onClick={onDismiss} type="button">閉じる</button>
    </section>
  );
}

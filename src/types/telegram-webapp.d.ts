interface TelegramHapticFeedback {
  impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
  notificationOccurred(type: "error" | "success" | "warning"): void;
  selectionChanged(): void;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    user?: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
    };
  };
  ready(): void;
  expand(): void;
  close(): void;
  colorScheme: "light" | "dark";
  themeParams: Record<string, string>;
  HapticFeedback?: TelegramHapticFeedback;
  onEvent(eventType: "themeChanged" | "viewportChanged", callback: () => void): void;
  offEvent(eventType: "themeChanged" | "viewportChanged", callback: () => void): void;
}

interface Window {
  Telegram?: {
    WebApp?: TelegramWebApp;
  };
}

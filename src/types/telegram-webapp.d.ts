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
}

interface Window {
  Telegram?: {
    WebApp?: TelegramWebApp;
  };
}

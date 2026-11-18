/**
 * Default product copy. Keeping user-facing enum labels in one locale module
 * prevents database values from leaking into the UI and lets a future `ru`
 * module implement the same shape without changing feature components.
 */
export const uz = {
  taskStatus: {
    ASSIGNED: "Biriktirilgan",
    IN_PROGRESS: "Jarayonda",
    BLOCKED: "Bloklangan",
    REVIEW: "Tekshiruvda",
    REVISION: "Tuzatishda",
    DONE: "Bajarildi",
    CANCELLED: "Bekor qilindi",
  },
  priority: {
    low: "Past",
    normal: "Oddiy",
    high: "Yuqori",
  },
  role: {
    OPERATOR_VIDEO_EDITOR: "Video operator / montajchi",
    CONTENT_MARKETER: "Kontent marketolog",
    DIGITAL_MARKETER: "Digital marketolog",
    SMM_MANAGER: "SMM Manager",
    HEAD_OF_MARKETING: "Marketing rahbari",
  },
  taskFilter: {
    my: "Mening vazifalarim",
    created: "Men yaratgan vazifalar",
    today: "Bugun",
    overdue: "Kechikkan",
    team: "Jamoa vazifalari",
    review: "Tekshiruv",
    blocked: "Bloklangan",
  },
  navigation: {
    home: "Bosh sahifa",
    tasks: "Vazifalar",
    calendar: "Taqvim",
    team: "Jamoa",
    reports: "Hisobot",
  },
} as const;

export type TranslationCatalog = {
  [Section in keyof typeof uz]: {
    [Key in keyof (typeof uz)[Section]]: string;
  };
};

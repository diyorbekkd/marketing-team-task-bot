# Ketma-ket vazifalar uchun taklif

Bu hujjat 2026-11-15 dagi mahsulot muhokamasi uchun. Hozirgi workflow qoidalarini hali o‘zgartirmaydi.

## Hozirgi holat

Workflow shablonining har bosqichida `due_after_hours` bor. Birinchi va keyingi vazifa ochilishi bilanoq shu davomiylik deadlinega aylanadi. Har bosqichda bitta assignee bor; boshqa ishtirokchilar alohida ko‘rsatilmaydi. Bir bosqich tasdiqlanganda keyingisi avtomatik yaratiladi. Bu foydalanuvchi kutayotgan topshirish va muddat belgilash tartibiga mos emas.

## Taklif etilgan tartib

1. Shablon ketma-ket vazifalar rejasi bo‘ladi: bosqich nomi, mas’ul (owner), ixtiyoriy ishtirokchilar, oldindan belgilangan checkpointlar va **taxminiy ish vaqti**. Taxminiy vaqt hech qachon avtomatik deadlinega aylanmaydi.
2. Jarayon boshlovchisi birinchi bosqich uchun aniq deadline belgilaydi. Barcha bosqichlar jamoaga umumiy reja sifatida ko‘rinadi. Navbati kelmagan bosqichlar kechikkan vazifa sifatida hisoblanmaydi.
3. Faol bosqich mas’uli ishni tekshiruvga yuborayotganda **keyingi bosqichning deadline**ini taklif qiladi. Tekshiruvchi tasdiqlagach keyingi mas’ulga shu aniq deadline bilan vazifa ochiladi va bot xabar beradi. Qayta ishlashga yuborilsa, keyingi vazifa ochilmaydi.
4. Har bosqichning bitta mas’uli bor. U status va natija uchun javob beradi. Ishtirokchilar vazifani ko‘radi, izoh va material qo‘shadi, lekin mas’ul o‘rniga tugatmaydi. Tekshiruvchi — yaratuvchi yoki Marketing rahbari.
5. Vazifa yaratuvchisi va mas’uli **aynan bir odam** bo‘lsa, ishni `IN_PROGRESS` yoki `REVISION`dan to‘g‘ridan-to‘g‘ri `DONE`ga o‘tkazish uchun alohida, atomik amal kerak. Bu chegara foydalanuvchi tomonidan tasdiqlandi. Amal checklist darvozasini, tarix yozuvlarini, bot xabarini va workflow keyingi bosqichini saqlashi kerak. Ketma-ket workflowda shu amal paytida ham keyingi deadline kiritiladi.
6. Ishtirokchilarga jarayon boshlanganda reja haqida, navbati kelganda esa aniq vazifa va deadline haqida xabar beriladi. Xabarlar bitta mantiqiy hodisa uchun takrorlanmasligi kerak.

## Kelishilgan qaror

Navbati kelmagan bosqichlar faqat umumiy jarayon rejasida ko‘rinadi. Oldingi bosqich tasdiqlangach, keyingisi aniq deadline bilan oddiy vazifaga aylanadi. Deadline hali noma’lum bosqichlar ochiq/kechikkan vazifalar statistikasiga kirmaydi. Bu tanlov foydalanuvchi tomonidan tasdiqlandi.

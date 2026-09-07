import type { Manifest, FlashState } from "esp-web-tools/dist/const";
import type { flash } from "esp-web-tools/dist/flash";

export type FlashImplementation = typeof flash;

// connect() only opens ESP Web Tools' dialog. The flash API reports the actual
// terminal state, including failures that resolve rather than reject its promise.
export async function writeFirmware(
  port: Parameters<FlashImplementation>[1],
  manifest: Manifest,
  baseUrl: string,
  erase: boolean,
  onState: (state: FlashState) => void,
  implementation?: FlashImplementation,
) {
  const write = implementation ?? (await import("esp-web-tools/dist/flash")).flash;
  let finished = false;
  let failure = "";
  await write((event) => {
    if (event.state === "finished") finished = true;
    if (event.state === "error") failure = event.details.error;
    onState(event);
  }, port, baseUrl, manifest, erase);
  if (failure) {
    const messages: Record<string, string> = {
      failed_initialize: "Плата не перейшла в режим запису. Перевір USB-кабель; за потреби затисни BOOT і повтори спробу.",
      not_supported: "Тип підключеної плати не збігається з обраним. Вибери правильну плату в кроці 1.",
      failed_firmware_download: "Не вдалося завантажити файли прошивки. Перевір інтернет і повтори спробу.",
      write_failed: "Запис перервався. Перевір USB-кабель і живлення, потім повтори прошивання.",
    };
    throw new Error(messages[failure] ?? "Прошивання не завершилося. Перевір підключення та повтори спробу.");
  }
  if (!finished) throw new Error("Запис не підтверджено. Відновлення налаштувань не розпочато.");
}

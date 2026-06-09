declare module "esp-web-tools/dist/web/install-button.js";
declare module "esp-web-tools/dist/connect.js" {
  export function connect(button: HTMLElement): Promise<void>;
}

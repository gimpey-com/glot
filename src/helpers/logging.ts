import style from "../cli-style";

export function log(...a: any[]) {
  console.log(...a);
}

export function warn(...a: any[]) {
  console.warn(style.yellow("[WARN]"), ...a);
}

export function info(...a: any[]) {
  console.info(style.cyan("[INFO]"), ...a);
}

export function ok(...a: any[]) {
  console.log(style.green("[OKAY]"), ...a);
}

export function err(...a: any[]) {
  console.error(style.red("[ERRR]"), ...a);
}

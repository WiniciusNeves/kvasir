import {
  confirm as inquirerConfirm,
  select as inquirerSelect,
  input as inquirerInput,
  checkbox as inquirerCheckbox,
  expand as inquirerExpand,
  editor as inquirerEditor,
  password as inquirerPassword,
} from '@inquirer/prompts';

export async function confirm(message: string): Promise<boolean> {
  return inquirerConfirm({ message });
}

export interface SelectChoice<T extends string> {
  name: string;
  value: T;
}

export async function select<T extends string>(message: string, choices: SelectChoice<T>[]): Promise<T> {
  return inquirerSelect<T>({ message, choices });
}

export async function input(message: string, defaultValue?: string): Promise<string> {
  return inquirerInput({ message, default: defaultValue });
}

export async function checkbox<T extends string>(message: string, choices: SelectChoice<T>[]): Promise<T[]> {
  return inquirerCheckbox<T>({ message, choices });
}

export type ExpandKey =
  | 'a'
  | 'b'
  | 'c'
  | 'd'
  | 'e'
  | 'f'
  | 'g'
  | 'i'
  | 'j'
  | 'k'
  | 'l'
  | 'm'
  | 'n'
  | 'o'
  | 'p'
  | 'q'
  | 'r'
  | 's'
  | 't'
  | 'u'
  | 'v'
  | 'w'
  | 'x'
  | 'y'
  | 'z'
  | '0'
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9';

export interface ExpandChoice<T extends string> {
  key: ExpandKey;
  name: string;
  value: T;
}

export async function expandChoice<T extends string>(
  message: string,
  choices: ExpandChoice<T>[],
  defaultKey?: ExpandKey
): Promise<T> {
  return inquirerExpand<T>({ message, choices, default: defaultKey });
}

// Hidden input (API keys): the typed value is masked and never echoed.
export async function password(message: string): Promise<string> {
  return inquirerPassword({ message, mask: '*' });
}

export async function editor(message: string, defaultValue?: string): Promise<string> {
  return inquirerEditor({ message, default: defaultValue });
}

// Test-only static catalog for dictionary integrity suites.
// Production code must NEVER import this module (enforced by shellBoundary.test.ts).
import zhCN from './zh-CN.json';
import mvpZhCN from './mvp-zh-CN.json';
import mvpUi from './mvp-ui.json';
import ja from './ja.json';
import ko from './ko.json';
import de from './de.json';
import fr from './fr.json';
import ru from './ru.json';
import es from './es.json';
import ptBR from './pt-BR.json';
import it from './it.json';
import tr from './tr.json';
import type { Locale, Message, NonEnglishLocale } from './manifest';

export const dictionaries: Record<NonEnglishLocale, Record<string, Message>> = {
  'zh-CN': zhCN, ja, ko, de, fr, ru, es, 'pt-BR': ptBR, it, tr,
};

export const mvpMessages: Partial<Record<Locale, Record<string, Message>>> = {
  'zh-CN': mvpZhCN,
  ...mvpUi,
};

// Card copy for the Library style Skills, one file per locale so no file outgrows the repository's 1 MiB limit.
import zhCN from './zh-CN.json';
import ja from './ja.json';
import ko from './ko.json';
import ru from './ru.json';
import de from './de.json';
import fr from './fr.json';
import es from './es.json';
import ptBR from './pt-BR.json';
import it from './it.json';
import tr from './tr.json';

export const skillLibraryUi: Record<string, Record<string, string>> = { 'zh-CN': zhCN, ja, ko, ru, de, fr, es, 'pt-BR': ptBR, it, tr };
export default skillLibraryUi;

import { catalogLocale } from './template-locale.ts';

// Template instructions shared by catalogs and conversation recommendation cards.
export const templatePrompts: Record<string, string> = {
  "en": "Instructions: Use the OpenMotion plugin. If it is not installed, follow {installUrl} to install and connect it, then continue.\nSelected template: {name} ({id})\nCreative brief: Adapt the template using my requirements and attachments. Preserve the template's original scenes, UI, and animation structure (replace copy and media in place for editable templates) instead of rebuilding a simple text-card layout; explain trade-offs first if user content must be dropped. Deliver HTML and MP4.\nMy requirements:\n",
  "zh-CN": "使用说明：请使用 OpenMotion 插件。如未安装，请按 `{installUrl}` 安装并接入后继续。\n指定模板：{name}（{id}）\n创作要求：基于模板，结合我的要求和附件创作。保留原模板的场景、界面和动画结构（可编辑模板直接原地替换文字与素材），不另写简陋文字卡页面；需要舍弃内容时先说明取舍，并交付 HTML 和 MP4。\n我的要求：\n",
  "de": "Anleitung: Verwende das OpenMotion-Plugin. Falls es noch nicht installiert ist, installiere und verbinde es gemäß {installUrl} und fahre dann fort.\nAusgewählte Vorlage: {name} ({id})\nGestaltungsauftrag: Passe die Vorlage anhand meiner Anforderungen und Anhänge an. Behalte die ursprünglichen Szenen, Oberflächen und Animationen bei (ersetze bei editierbaren Vorlagen Texte und Medien direkt vor Ort), statt einfache Textkarten neu zu bauen; erkläre Kompromisse zuerst, wenn Inhalte wegfallen müssen. Liefere HTML und MP4.\nMeine Anforderungen:\n",
  "fr": "Instructions : utilise le plugin OpenMotion. S’il n’est pas installé, suis {installUrl} pour l’installer et le connecter, puis continue.\nModèle sélectionné : {name} ({id})\nConsignes de création : adapte le modèle à mes exigences et pièces jointes. Préserve ses scènes, interfaces et animations d’origine (remplace directement textes et médias sur les modèles modifiables) au lieu de reconstruire de simples cartes de texte ; explique d’abord les compromis si du contenu doit être écarté. Livre un HTML et un MP4.\nMes exigences :\n",
  "es": "Instrucciones: usa el plugin OpenMotion. Si no está instalado, sigue {installUrl} para instalarlo y conectarlo; después, continúa.\nPlantilla seleccionada: {name} ({id})\nIndicaciones creativas: adapta la plantilla según mis requisitos y archivos adjuntos. Conserva las escenas, interfaces y animaciones originales (en plantillas editables, reemplaza textos y medios directamente en su lugar) en vez de rehacer tarjetas de texto simples; explica primero los ajustes si hay que omitir contenido. Entrega HTML y MP4.\nMis requisitos:\n",
  "it": "Istruzioni: usa il plugin OpenMotion. Se non è installato, segui {installUrl} per installarlo e collegarlo, poi continua.\nModello selezionato: {name} ({id})\nIndicazioni creative: adatta il modello ai miei requisiti e agli allegati. Preserva le scene, interfacce e animazioni originali (nei modelli modificabili sostituisci testi e media direttamente sul posto) invece di ricostruire semplici schede di testo; spiega prima eventuali compromessi se parte del contenuto va esclusa. Consegna HTML e MP4.\nI miei requisiti:\n",
  "ja": "使用方法：OpenMotion プラグインを使用してください。未インストールの場合は、{installUrl} の手順に従ってインストールと接続を済ませてから続けてください。\n指定テンプレート：{name}（{id}）\n制作要件：テンプレートを基に、私の要望と添付素材を取り入れて制作してください。簡素なテキストカードを作り直すのではなく、元のシーン・UI・アニメーション構造を保ってください（編集可能なテンプレートでは文字や素材を直接差し替え）。内容を削る必要がある場合は先に取捨選択を説明し、HTML と MP4 を納品してください。\n私の要望：\n",
  "ko": "사용 안내: OpenMotion 플러그인을 사용해 주세요. 설치되어 있지 않으면 {installUrl}의 안내에 따라 설치하고 연결한 후 계속 진행해 주세요.\n지정 템플릿: {name} ({id})\n제작 요구사항: 템플릿을 바탕으로 내 요구사항과 첨부 자료를 반영해 제작해 주세요. 단순한 텍스트 카드 화면을 새로 만들지 말고 원본 장면·UI·애니메이션 구조를 유지해 주세요(편집 가능한 템플릿은 텍스트와 미디어를 그 자리에서 직접 교체). 내용을 줄여야 하면 먼저 취사선택을 설명하고 HTML과 MP4를 제공해 주세요.\n내 요구사항:\n",
  "ru": "Инструкции: Используйте плагин OpenMotion. Если он не установлен, установите и подключите его по инструкции {installUrl}, затем продолжите.\nВыбранный шаблон: {name} ({id})\nТворческое задание: Адаптируйте шаблон с учётом моих требований и вложений. Сохраните исходные сцены, интерфейсы и анимации шаблона (в редактируемых шаблонах заменяйте тексты и медиа прямо на месте) вместо создания простых текстовых карточек; если часть содержания придётся опустить, сначала объясните компромиссы. Предоставьте HTML и MP4.\nМои требования:\n",
  "tr": "Talimatlar: OpenMotion eklentisini kullanın. Yüklü değilse {installUrl} adresindeki talimatlarla kurup bağlayın, ardından devam edin.\nSeçilen şablon: {name} ({id})\nYaratıcı brief: Şablonu isteklerime ve eklerime göre uyarlayın. Basit metin kartları oluşturmak yerine şablonun özgün sahne, arayüz ve animasyon yapısını koruyun (düzenlenebilir şablonlarda metin ve medyaları doğrudan yerinde değiştirin); içerik çıkarılması gerekiyorsa önce ödünleri açıklayın. HTML ve MP4 teslim edin.\nİsteklerim:\n",
  "pt-br": "Instruções: Use o plugin OpenMotion. Se ainda não estiver instalado, siga {installUrl} para instalar e conectar, depois continue.\nModelo selecionado: {name} ({id})\nBriefing criativo: Adapte o modelo com base nos meus requisitos e anexos. Preserve as cenas, interfaces e animações originais (em modelos editáveis, substitua textos e mídias diretamente no lugar) em vez de recriar cartões simples de texto; explique primeiro os ajustes se algum conteúdo precisar ficar de fora. Entregue HTML e MP4.\nMeus requisitos:\n"
};

/** Shared creation brief; source capabilities are resolved after the user submits it. */
export function formatTemplatePrompt(template: { id: string; title: string }, locale = 'zh-CN'): string {
  const message = templatePrompts[catalogLocale(Object.keys(templatePrompts), locale, 'en')];
  return fillTemplatePrompt(message, template);
}

function fillTemplatePrompt(message: string, template: { id: string; title: string }): string {
  const values = { installUrl: 'https://github.com/nexu-io/openmotion', name: template.title, id: template.id };
  return message.replace(/\{(installUrl|name|id)\}/g, (_, key: keyof typeof values) => values[key]);
}

const handoffBriefs: Record<string, { editable: string; reference: string; requirements: string }> = {
  de: {
    editable: 'Editierbares Projekt: Lies die ausgewählte Vorlage und erstelle daraus ein eigenes Projekt. Passe es an meine Anforderungen und Anhänge an. Behalte vorhandene Projekte und gib mir den Link zum neuen Projekt.',
    reference: 'Videoreferenz ohne editierbares Original: Lies die Referenz und erstelle mit meinen Anforderungen und Anhängen ein eigenes Projekt. Versprich keine exakte Kopie. Behalte vorhandene Projekte und gib mir den Link zum neuen Projekt.',
    requirements: 'Prüfe den Produktnamen und die Texte sowie bei Bedarf Screenshots oder Bildschirmaufnahmen. Frage nach fehlendem Material. Statt eines Logos ist ein Schriftzug möglich; fehlt Audio, verwende Stille. Öffne das verlinkte Projekt, prüfe die Inhalte und arbeite im selben Projekt weiter.',
  },
  fr: {
    editable: 'Projet modifiable : lis le modèle sélectionné, crée un projet indépendant et adapte-le à mes exigences et pièces jointes. Préserve mes projets existants et donne-moi le lien du nouveau projet.',
    reference: 'Vidéo de référence sans projet original modifiable : lis la référence et crée un projet indépendant avec mes exigences et pièces jointes, sans promettre une copie exacte. Préserve mes projets existants et donne-moi le lien du nouveau projet.',
    requirements: 'Vérifie le nom du produit et les textes, ainsi que les captures ou enregistrements d’écran si nécessaire. Demande les éléments indispensables qui manquent. Le nom de la marque en texte peut remplacer le logo ; sans audio fourni, laisse le projet muet. Ouvre le projet lié, vérifie le contenu et poursuis dans ce même projet.',
  },
  es: {
    editable: 'Proyecto editable: lee la plantilla seleccionada, crea un proyecto independiente y adáptalo a mis requisitos y archivos adjuntos. Conserva los proyectos existentes y dame el enlace al nuevo proyecto.',
    reference: 'Vídeo de referencia sin proyecto original editable: lee la referencia y crea un proyecto independiente con mis requisitos y archivos adjuntos, sin prometer una copia exacta. Conserva los proyectos existentes y dame el enlace al nuevo proyecto.',
    requirements: 'Comprueba el nombre del producto y los textos, así como las capturas o grabaciones de pantalla que hagan falta. Pide los materiales imprescindibles que falten. El nombre de la marca en texto puede sustituir al logotipo; si no hay audio, deja silencio. Abre el proyecto del enlace, verifica el contenido y sigue en ese mismo proyecto.',
  },
  it: {
    editable: 'Progetto modificabile: leggi il modello selezionato, crea un progetto indipendente e adattalo ai miei requisiti e allegati. Conserva i progetti esistenti e dammi il link al nuovo progetto.',
    reference: 'Video di riferimento senza progetto originale modificabile: leggi il riferimento e crea un progetto indipendente con i miei requisiti e allegati, senza promettere una copia esatta. Conserva i progetti esistenti e dammi il link al nuovo progetto.',
    requirements: 'Controlla il nome del prodotto e i testi, oltre alle schermate o registrazioni necessarie. Chiedi i materiali essenziali mancanti. Il nome del brand in testo può sostituire il logo; senza audio usa il silenzio. Apri il progetto dal link, verifica il contenuto e continua nello stesso progetto.',
  },
  ja: {
    editable: '編集可能なプロジェクト：指定のテンプレートを確認し、別のプロジェクトを作成して、私の要望と添付素材に合わせて編集してください。既存のプロジェクトは残し、新しいプロジェクトのリンクを返してください。',
    reference: '参照動画（編集可能な元プロジェクトなし）：動画を参照し、私の要望と添付素材を使って別のプロジェクトを作成してください。完全な再現は約束せず、既存のプロジェクトを残し、新しいプロジェクトのリンクを返してください。',
    requirements: '製品名と文言を確認し、必要に応じてスクリーンショットや画面収録も確認してください。必須素材がなければ尋ねてください。ロゴはブランド名の文字表記で代用できます。音声素材がなければ無音にしてください。リンク先のプロジェクトを開いて内容を確認し、同じプロジェクトで作業を続けてください。',
  },
  ko: {
    editable: '편집 가능한 프로젝트: 지정한 템플릿을 확인하고 별도 프로젝트를 만든 뒤 내 요구사항과 첨부 자료에 맞게 편집해 주세요. 기존 프로젝트는 보존하고 새 프로젝트 링크를 알려 주세요.',
    reference: '참고 영상(편집 가능한 원본 프로젝트 없음): 영상을 확인하고 내 요구사항과 첨부 자료를 사용해 별도 프로젝트를 만들어 주세요. 정확한 복제를 약속하지 말고 기존 프로젝트를 보존한 뒤 새 프로젝트 링크를 알려 주세요.',
    requirements: '제품 이름과 문구를 확인하고, 필요한 경우 스크린샷이나 화면 녹화도 확인해 주세요. 필수 자료가 빠졌다면 요청해 주세요. 로고는 브랜드 이름 텍스트로 대체할 수 있고, 오디오가 없으면 무음으로 두세요. 링크의 프로젝트를 열어 내용을 확인하고 같은 프로젝트에서 이어서 작업해 주세요.',
  },
  ru: {
    editable: 'Редактируемый проект: изучите выбранный шаблон, создайте отдельный проект и адаптируйте его с учётом моих требований и вложений. Сохраните существующие проекты и дайте ссылку на новый проект.',
    reference: 'Видео для примера без редактируемого исходного проекта: изучите видео и создайте отдельный проект с учётом моих требований и вложений. Не обещайте точную копию, сохраните существующие проекты и дайте ссылку на новый проект.',
    requirements: 'Проверьте название продукта и тексты, а при необходимости — снимки или записи экрана. Запросите недостающие обязательные материалы. Вместо логотипа можно использовать текстовое название бренда; без аудио оставьте тишину. Откройте проект по ссылке, проверьте содержимое и продолжайте в этом же проекте.',
  },
  tr: {
    editable: 'Düzenlenebilir proje: Seçilen şablonu inceleyin, ayrı bir proje oluşturun ve isteklerime ve eklerime göre uyarlayın. Mevcut projeleri koruyun ve yeni projenin bağlantısını paylaşın.',
    reference: 'Düzenlenebilir özgün projesi olmayan referans video: Videoyu inceleyin ve isteklerimle eklerimi kullanarak ayrı bir proje oluşturun. Birebir kopya vaat etmeyin, mevcut projeleri koruyun ve yeni projenin bağlantısını paylaşın.',
    requirements: 'Ürün adını, metinleri ve gerekiyorsa ekran görüntülerini veya kayıtlarını kontrol edin. Eksik zorunlu malzemeleri isteyin. Logo yerine marka adını metin olarak kullanabilirsiniz; ses yoksa sessiz bırakın. Bağlantıdaki projeyi açın, içeriği doğrulayın ve aynı projede devam edin.',
  },
  'pt-br': {
    editable: 'Projeto editável: consulte o modelo selecionado, crie um projeto independente e adapte-o aos meus requisitos e anexos. Preserve os projetos existentes e forneça o link para o novo projeto.',
    reference: 'Vídeo de referência sem projeto original editável: consulte o vídeo e crie um projeto independente com meus requisitos e anexos, sem prometer uma cópia exata. Preserve os projetos existentes e forneça o link para o novo projeto.',
    requirements: 'Confira o nome do produto e os textos, além das capturas ou gravações de tela necessárias. Peça os materiais essenciais que faltarem. O nome da marca em texto pode substituir o logotipo; sem áudio, deixe o projeto em silêncio. Abra o projeto do link, confira o conteúdo e continue no mesmo projeto.',
  },
};

export function formatLocalizedTemplateHandoff(template: { id: string; title: string }, editable: boolean, locale: string): string | undefined {
  const language = catalogLocale(Object.keys(templatePrompts), locale, 'en');
  const brief = handoffBriefs[language];
  if (!brief) return undefined;
  const [connection, selection, , requirements] = templatePrompts[language].split('\n');
  return fillTemplatePrompt([connection, selection, editable ? brief.editable : brief.reference, brief.requirements, requirements, ''].join('\n'), template);
}

import type { Language, TemplateId } from './types.ts';

export const languages = ['zh', 'en', 'ja', 'ko', 'fr', 'es', 'pt'] as const;
// HTML project previews describe the template; media provenance belongs in the installation guide.
export const inlineDescriptionPrefixes: Record<Language, string> = {
  zh: '简介：', en: 'Summary: ', ja: '概要：', ko: '소개: ',
  fr: 'Présentation : ', es: 'Resumen: ', pt: 'Resumo: ',
};
export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && languages.includes(value as Language);
}
export function resolveLanguage(value?: string): Language {
  if (!value) return 'zh';
  const base = value.toLowerCase().split(/[-_]/)[0];
  return isLanguage(base) ? base : 'en';
}
type Translation = {
  ui: { waiting: string; unavailable: string; loading: string; failed: string; blocked: string;
    preview: string; clone: string; back: string; close: string; player: string; sending: string; notSent: string;
    manual: string; draftLabel: string; copied: string; copyFailed: string; welcomeLabel: string; listLabel: string };
  welcome: { heading: string; discovery: string; introduction: string; recommendations: string; draft: string; clipboardDraft: string };
  descriptions: Partial<Record<TemplateId, string>>;
};
export const translations: Record<Language, Translation> = {
  zh: {
    ui: { copied: "已复制，请粘贴到对话框后补充要求。", copyFailed: "复制失败，请重试。", waiting: '正在准备模板预览…', unavailable: '模板预览暂不可用，请在聊天中选择模板。', loading: '正在加载预览…',
      failed: '视频暂时无法播放，仍可选择此模板。', blocked: '点击放大预览后播放。', preview: '放大预览', clone: '复刻模板',
      back: '返回模板列表', close: '关闭预览', player: '模板完整预览', sending: '正在填入…', notSent: '未能填入，请重试。',
      manual: '当前客户端暂不支持填入输入框，请复制下方提示词。', draftLabel: '模板创作提示词',
      welcomeLabel: 'OpenMotion 欢迎', listLabel: 'OpenMotion 模板' },
    welcome: { clipboardDraft: "点击下方卡片上的「复刻模板」即可复制提示词，粘贴到对话框，补充要求或附件后发送。", heading: '🎉 OpenMotion 安装好啦，右侧就是模板库！',
      introduction: '我是你的开源视频创作搭档，我有丰富的高水准视频模板，也支持从参考视频或一个灵感出发，和你一起创作精彩的视频。',
      discovery: '模板库支持搜索，也可以随意浏览，找到喜欢的点击「复刻模板」就能开始你的创作！',
      recommendations: '不想自己找？先看看我挑的这 3 个 👇',
      draft: '你可以点击下方卡片上的「复刻模板」，然后补充「我的要求」或添加附件，发送后就开始创作！' },
    descriptions: { 'product-promo': '从图标开场到多人协作，查看多场景动画与字幕编排。', 'nyt-graph': '报刊风格的动态图表，查看数据、标注与图形的节奏。', 'decision-tree': '逐步展开的决策树，查看节点、连线与分支动画。' },
  },
  en: {
    ui: { copied: "Copied. Paste into the chat and add your requirements.", copyFailed: "Copy failed. Please try again.", waiting: 'Preparing template previews…', unavailable: 'Template previews are unavailable. Choose a template in the chat.', loading: 'Loading preview…',
      failed: 'This video cannot play. You can still choose the template.', blocked: 'Open the larger preview to play.', preview: 'Enlarge preview', clone: 'Recreate template',
      back: 'Back to templates', close: 'Close preview', player: 'Full template preview', sending: 'Adding to composer…', notSent: 'Not added. Please try again.',
      manual: 'This client cannot fill the composer. Copy the prompt below.', draftLabel: 'Template creation prompt',
      welcomeLabel: 'OpenMotion welcome', listLabel: 'OpenMotion templates' },
    welcome: { clipboardDraft: "Choose Recreate template to copy its prompt, paste it into the chat, add your requirements or attachments, then send.", heading: '🎉 OpenMotion is installed. Your template library is open on the right!',
      introduction: 'I am your open-source video creation partner. I have a rich collection of high-quality video templates, and I can also help you create a video from a reference or an idea.',
      discovery: 'Search or browse the template library. When you find one you like, choose Recreate template to start creating!',
      recommendations: 'Want a starting point? Try one of these three 👇',
      draft: 'Choose Recreate template on a card below, add your requirements or attachments, then send it to start creating!' },
    descriptions: { 'product-promo': 'From an opening icon to team collaboration, explore multi-scene animation and caption sequencing.', 'nyt-graph': 'Newspaper-style animated charts, with carefully paced data, annotations and graphics.', 'decision-tree': 'Explore a decision tree that unfolds through animated nodes, connections and branches.' },
  },
  ja: {
    ui: { copied: "コピーしました。チャットに貼り付けて要望を追加してください。", copyFailed: "コピーできませんでした。もう一度お試しください。", waiting: 'テンプレートのプレビューを準備中…', unavailable: 'プレビューを利用できません。チャットでテンプレートを選んでください。', loading: 'プレビューを読み込み中…',
      failed: '動画を再生できませんが、このテンプレートは選択できます。', blocked: '拡大プレビューを開いて再生してください。', preview: 'プレビューを拡大', clone: 'テンプレートを再現',
      back: 'テンプレート一覧に戻る', close: 'プレビューを閉じる', player: 'テンプレートの全編プレビュー', sending: '入力欄に追加中…', notSent: '追加できませんでした。もう一度お試しください。',
      manual: 'このクライアントでは入力欄に追加できません。下のプロンプトをコピーしてください。', draftLabel: 'テンプレート制作プロンプト',
      welcomeLabel: 'OpenMotion へようこそ', listLabel: 'OpenMotion テンプレート' },
    welcome: { clipboardDraft: "「テンプレートを再現」でプロンプトをコピーし、チャットに貼り付けて要望やファイルを追加してから送信してください。", heading: '🎉 OpenMotion のインストールが完了しました。右側にテンプレートライブラリがあります！',
      introduction: '私は、オープンソースの動画制作パートナーです。高品質な動画テンプレートを豊富に用意しています。参考動画やアイデアからも、一緒に動画を制作できます。',
      discovery: 'テンプレートライブラリは検索も自由な閲覧もできます。気に入ったものが見つかったら「テンプレートを再現」をクリックして制作を始めましょう！',
      recommendations: 'どれにするか迷ったら、まずはこの3つをどうぞ 👇',
      draft: '下のカードの「テンプレートを再現」をクリックし、「私の要望」を記入するかファイルを添付して送信すると、制作が始まります！' },
    descriptions: { 'product-promo': 'アイコンでのオープニングからチームでの共同作業まで、多彩なシーンのアニメーションと字幕構成を紹介します。', 'nyt-graph': '新聞風のアニメーショングラフで、データ、注釈、図形のリズムを表現します。', 'decision-tree': 'ノードや接続線、分岐が順に展開する決定木のアニメーションです。' },
  },
  ko: {
    ui: { copied: "복사했습니다. 대화창에 붙여넣고 요구 사항을 추가하세요.", copyFailed: "복사하지 못했습니다. 다시 시도해 주세요.", waiting: '템플릿 미리보기를 준비하는 중…', unavailable: '템플릿 미리보기를 사용할 수 없습니다. 채팅에서 템플릿을 선택해 주세요.', loading: '미리보기를 불러오는 중…',
      failed: '영상을 재생할 수 없지만 이 템플릿을 선택할 수 있습니다.', blocked: '확대 미리보기를 열어 재생해 주세요.', preview: '미리보기 확대', clone: '템플릿 재현',
      back: '템플릿 목록으로 돌아가기', close: '미리보기 닫기', player: '템플릿 전체 미리보기', sending: '입력창에 추가하는 중…', notSent: '추가하지 못했습니다. 다시 시도해 주세요.',
      manual: '이 클라이언트에서는 입력창에 추가할 수 없습니다. 아래 프롬프트를 복사해 주세요.', draftLabel: '템플릿 제작 프롬프트',
      welcomeLabel: 'OpenMotion에 오신 것을 환영합니다', listLabel: 'OpenMotion 템플릿' },
    welcome: { clipboardDraft: "「템플릿 재현」으로 프롬프트를 복사한 뒤 대화창에 붙여넣고 요구 사항이나 파일을 추가해 전송하세요.", heading: '🎉 OpenMotion 설치가 완료되었습니다. 오른쪽에 템플릿 라이브러리가 있어요!',
      introduction: '저는 여러분의 오픈 소스 영상 제작 파트너입니다. 다양한 고품질 영상 템플릿을 갖추고 있으며, 참고 영상이나 아이디어를 바탕으로 함께 영상을 만들 수도 있어요.',
      discovery: '템플릿 라이브러리에서 검색하거나 자유롭게 둘러보세요. 마음에 드는 템플릿의 「템플릿 재현」을 누르면 제작을 시작할 수 있어요!',
      recommendations: '고르기 어렵다면 제가 추천하는 이 3가지를 먼저 살펴보세요 👇',
      draft: '아래 카드의 「템플릿 재현」을 누르고 「내 요구 사항」을 작성하거나 파일을 첨부한 뒤 전송하면 제작이 시작됩니다!' },
    descriptions: { 'product-promo': '아이콘으로 시작해 팀 협업으로 이어지는 다양한 장면의 애니메이션과 자막 구성을 살펴보세요.', 'nyt-graph': '신문 스타일의 애니메이션 차트로 데이터, 주석, 그래픽의 리듬을 표현합니다.', 'decision-tree': '노드, 연결선, 분기가 차례로 펼쳐지는 의사결정 트리 애니메이션입니다.' },
  },
  fr: {
    ui: { copied: "Copié. Collez dans le chat et ajoutez vos besoins.", copyFailed: "Échec de la copie. Réessayez.", waiting: 'Préparation des aperçus…', unavailable: 'Les aperçus sont indisponibles. Choisissez un modèle dans le chat.', loading: 'Chargement de l’aperçu…',
      failed: 'Cette vidéo ne peut pas être lue. Vous pouvez tout de même choisir ce modèle.', blocked: 'Ouvrez l’aperçu agrandi pour lancer la lecture.', preview: 'Agrandir l’aperçu', clone: 'Recréer le modèle',
      back: 'Retour aux modèles', close: 'Fermer l’aperçu', player: 'Aperçu complet du modèle', sending: 'Ajout dans la zone de saisie…', notSent: 'Échec de l’ajout. Réessayez.',
      manual: 'Ce client ne peut pas remplir la zone de saisie. Copiez la consigne ci-dessous.', draftLabel: 'Consigne de création',
      welcomeLabel: 'Bienvenue dans OpenMotion', listLabel: 'Modèles OpenMotion' },
    welcome: { clipboardDraft: "Choisissez « Recréer le modèle » pour copier la consigne, collez-la dans le chat, ajoutez vos besoins ou fichiers, puis envoyez.", heading: '🎉 OpenMotion est installé. La bibliothèque de modèles est ouverte à droite !',
      introduction: 'Je suis votre partenaire de création vidéo open source. Je propose de nombreux modèles vidéo de qualité et peux aussi créer avec vous à partir d’une vidéo de référence ou d’une idée.',
      discovery: 'Recherchez un modèle ou parcourez librement la bibliothèque. Cliquez sur « Recréer le modèle » pour commencer votre création !',
      recommendations: 'Besoin d’inspiration ? Découvrez ces 3 modèles que j’ai choisis 👇',
      draft: 'Cliquez sur « Recréer le modèle » sur une carte ci-dessous, complétez « Mes besoins » ou ajoutez des fichiers, puis envoyez votre demande pour lancer la création !' },
    descriptions: { 'product-promo': 'D’une icône d’ouverture à la collaboration en équipe, découvrez des scènes animées et leur enchaînement de sous-titres.', 'nyt-graph': 'Des graphiques animés au style journalistique, rythmant données, annotations et formes.', 'decision-tree': 'Découvrez un arbre de décision dont les nœuds, les liens et les branches se déploient progressivement.' },
  },
  es: {
    ui: { copied: "Copiado. Pega en el chat y añade tus requisitos.", copyFailed: "No se pudo copiar. Inténtalo de nuevo.", waiting: 'Preparando vistas previas…', unavailable: 'Las vistas previas no están disponibles. Elige una plantilla en el chat.', loading: 'Cargando vista previa…',
      failed: 'No se puede reproducir el vídeo, pero aún puedes elegir esta plantilla.', blocked: 'Abre la vista previa ampliada para reproducirlo.', preview: 'Ampliar vista previa', clone: 'Recrear plantilla',
      back: 'Volver a las plantillas', close: 'Cerrar vista previa', player: 'Vista previa completa de la plantilla', sending: 'Añadiendo al cuadro de texto…', notSent: 'No se pudo añadir. Inténtalo de nuevo.',
      manual: 'Este cliente no puede rellenar el cuadro de texto. Copia la instrucción de abajo.', draftLabel: 'Instrucción de creación',
      welcomeLabel: 'Te damos la bienvenida a OpenMotion', listLabel: 'Plantillas de OpenMotion' },
    welcome: { clipboardDraft: "Elige « Recrear plantilla » para copiar la instrucción, pégala en el chat, añade tus requisitos o archivos y envíala.", heading: '🎉 OpenMotion ya está instalado. ¡La biblioteca de plantillas está abierta a la derecha!',
      introduction: 'Soy tu compañero de creación de vídeos de código abierto. Tengo una amplia colección de plantillas de alta calidad y también puedo crear contigo a partir de un vídeo de referencia o una idea.',
      discovery: 'Busca una plantilla o explora la biblioteca a tu ritmo. ¡Haz clic en « Recrear plantilla » para empezar tu creación!',
      recommendations: '¿Necesitas inspiración? Mira estas 3 plantillas que he elegido 👇',
      draft: 'Haz clic en « Recrear plantilla » en una tarjeta, completa « Mis requisitos » o adjunta archivos y envía tu solicitud para empezar a crear.' },
    descriptions: { 'product-promo': 'Desde un icono inicial hasta la colaboración en equipo, descubre escenas animadas y la secuencia de sus subtítulos.', 'nyt-graph': 'Gráficos animados de estilo periodístico que combinan datos, anotaciones y formas con ritmo.', 'decision-tree': 'Explora un árbol de decisión cuyos nodos, conexiones y ramas se despliegan paso a paso.' },
  },
  pt: {
    ui: { copied: "Copiado. Cole no chat e adicione seus requisitos.", copyFailed: "Falha ao copiar. Tente novamente.", waiting: 'Preparando prévias dos modelos…', unavailable: 'As prévias estão indisponíveis. Escolha um modelo no chat.', loading: 'Carregando prévia…',
      failed: 'Não é possível reproduzir este vídeo, mas você ainda pode escolher o modelo.', blocked: 'Abra a prévia ampliada para reproduzir.', preview: 'Ampliar prévia', clone: 'Recriar modelo',
      back: 'Voltar aos modelos', close: 'Fechar prévia', player: 'Prévia completa do modelo', sending: 'Adicionando à caixa de texto…', notSent: 'Não foi possível adicionar. Tente novamente.',
      manual: 'Este cliente não pode preencher a caixa de texto. Copie a instrução abaixo.', draftLabel: 'Instrução de criação',
      welcomeLabel: 'Boas-vindas ao OpenMotion', listLabel: 'Modelos do OpenMotion' },
    welcome: { clipboardDraft: "Escolha « Recriar modelo » para copiar a instrução, cole no chat, adicione seus requisitos ou arquivos e envie.", heading: '🎉 OpenMotion instalado. A biblioteca de modelos está aberta à direita!',
      introduction: 'Sou seu parceiro de criação de vídeos de código aberto. Tenho uma ampla coleção de modelos de alta qualidade e também posso criar com você a partir de um vídeo de referência ou de uma ideia.',
      discovery: 'Pesquise um modelo ou explore a biblioteca à vontade. Clique em « Recriar modelo » para começar sua criação!',
      recommendations: 'Precisa de inspiração? Veja estes 3 modelos que escolhi 👇',
      draft: 'Clique em « Recriar modelo » em um cartão, preencha « Meus requisitos » ou anexe arquivos e envie sua solicitação para começar a criar!' },
    descriptions: { 'product-promo': 'De um ícone de abertura à colaboração em equipe, explore cenas animadas e a sequência de suas legendas.', 'nyt-graph': 'Gráficos animados de estilo jornalístico, com ritmo entre dados, anotações e formas.', 'decision-tree': 'Explore uma árvore de decisão com nós, conexões e ramificações que se revelam passo a passo.' },
  },
};

/** Plain reply text, kept outside the card document so the host can stream it. */
export function welcomeMarkdown(language: Language, cardsPosition: 'before' | 'after' = 'after'): string {
  const text = translations[language].welcome;
  const recommendations = cardsPosition === 'before' ? text.recommendations.replace('👇', '👆') : text.recommendations;
  const draft = cardsPosition === 'before' ? text.clipboardDraft.replace('下方', '上方') : text.clipboardDraft;
  return [`**${text.heading}**`, text.introduction, text.discovery, `**${recommendations}**`, draft].join("\n\n");
}

/** A plain reply remains available even when the host cannot mount native cards. */
export function installationFallbackWelcome(language: Language): string {
  const text = translations[language].welcome;
  return [text.heading, text.introduction, text.discovery].join('\n\n');
}

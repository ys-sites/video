import lunar from './scene-art/apollo-11.jpg';
import interior from './scene-art/speaker-room.webp';
import { sceneExamples } from './sceneShowcase';

const seedance = { name: 'Seedance 2.5', id: 'doubao-seedance-2-5-260628' };
const productPushIn = sceneExamples['image-to-video'][0];
const drinkSplash = sceneExamples['text-to-video'][0];

export type CinemaTemplate = {
  id: string;
  scene: 'text-to-video' | 'image-to-video';
  poster: string;
  credit?: string;
  model: typeof seedance;
  aspect: '16:9' | '9:16';
  duration: number;
  en: { title: string; tag: string; materials: string; prompt: string };
  zh: CinemaTemplate['en'];
};

export const cinemaTemplates: readonly CinemaTemplate[] = [{
  id: 'drink-splash-slow-motion',
  scene: 'text-to-video',
  poster: drinkSplash.poster,
  model: seedance,
  aspect: '16:9',
  duration: 8,
  en: {
    title: 'Slow-motion drink splash', tag: 'Product film', materials: 'No source assets needed', prompt: drinkSplash.prompt,
  },
  zh: {
    title: '饮料飞溅慢镜头', tag: '产品广告', materials: '无需上传素材',
    prompt: '拍一段橙色汽水瓶的慢动作特写，柑橘切片和薄荷围绕瓶身，清澈水花从两侧飞溅。镜头缓慢靠近，水珠和商品轮廓清晰，最后停在居中的汽水瓶。',
  },
}, {
  id: 'lunar-tracking-shot',
  scene: 'text-to-video',
  poster: lunar,
  credit: 'NASA · AS11-40-5903',
  model: seedance,
  aspect: '16:9',
  duration: 8,
  en: {
    title: 'Lunar tracking shot', tag: 'Science fiction', materials: 'No source assets needed',
    prompt: 'A wide cinematic shot on an airless moon. A lone astronaut walks across a gray ridge beneath a black sky. Track parallel at knee height, letting the nearby rocks pass quickly while the horizon moves slowly. Hard sidelight picks out dust lifting from each step. End with the astronaut in profile overlooking a crater. Keep the walk and camera move continuous.',
  },
  zh: {
    title: '月面低机位跟拍', tag: '科幻场景', materials: '无需上传素材',
    prompt: '横屏电影广角。黑色天幕下，一名宇航员独自走过灰色月面山脊。镜头在膝盖高度平行跟拍，近处岩石快速掠过，远处地平线缓慢移动。硬侧光照亮每一步扬起的尘粒。结尾以宇航员的侧影和远处环形山构图，人物步伐和镜头运动保持连续。',
  },
}, {
  id: 'interior-first-frame',
  scene: 'image-to-video',
  poster: interior,
  model: seedance,
  aspect: '16:9',
  duration: 5,
  en: {
    title: 'Interior slow push-in', tag: 'Camera movement', materials: '1 first-frame image',
    prompt: 'Use the uploaded interior image exactly as the first frame. Push the camera slowly toward the central subject. Keep architecture, furniture, and colors fixed. Let soft window light move slightly along the floor as foreground objects shift naturally with the camera. Hold the final composition briefly. One continuous shot.',
  },
  zh: {
    title: '室内首帧慢推', tag: '运镜练习', materials: '需上传 1 张室内首帧图',
    prompt: '以上传的室内图作为首帧，镜头缓慢推向画面主体。保持建筑结构、家具位置和原有色彩，窗光在地板上轻微移动，近处物件随镜头产生自然视差。最后短暂停在推近后的构图，全程一个连续镜头。',
  },
}, {
  id: 'product-window-light-push-in',
  scene: 'image-to-video',
  poster: productPushIn.poster,
  model: seedance,
  aspect: '16:9',
  duration: 8,
  en: {
    title: 'Warm window light product shot', tag: 'Product film', materials: '1 product first frame', prompt: productPushIn.prompt,
  },
  zh: {
    title: '暖窗光商品慢推', tag: '产品广告', materials: '需上传 1 张商品首帧图',
    prompt: '以上传图片作为首帧。保持商品外形、标签和台面位置。镜头缓慢推近，一束暖窗光扫过商品，影子随光线自然移动。结束时保持商品清晰，整个镜头不切换。',
  },
}, {
  id: 'product-light-reveal',
  scene: 'text-to-video',
  poster: productPushIn.poster,
  model: seedance,
  aspect: '9:16',
  duration: 6,
  en: {
    title: 'Product light reveal', tag: 'Product film', materials: 'No source assets needed',
    prompt: 'A single continuous vertical product shot. An unbranded amber glass bottle sits on a smooth stone plinth. Start in shadow on a close-up of the glass edge. Pull back slowly while a narrow band of warm light travels across the bottle and casts a long reflection on the stone. Finish on a centered, sharply focused packshot. Keep the bottle still and its silhouette consistent.',
  },
  zh: {
    title: '光影产品亮相', tag: '产品广告', materials: '无需上传素材',
    prompt: '竖屏连续产品镜头。无标识的琥珀色玻璃瓶静置在光滑的石质台座上。开场贴近玻璃边缘，主体大部分藏在阴影里。镜头缓慢拉远，一束窄幅暖光从瓶身掠过，在台座上拉出清晰倒影。最后停在清晰、居中的产品全貌。瓶子全程保持静止，轮廓一致。',
  },
}];

export function findCinemaTemplate(id: string | null | undefined) {
  return cinemaTemplates.find(template => template.id === id);
}

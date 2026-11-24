import type { StepProps } from '../stepContract';
import { BriefStep } from './BriefStep';
import { MediaStep } from './MediaStep';
import { SocialPackStep } from './SocialPackStep';
import { WebPageStep } from './WebPageStep';
import './steps.css';

export function StepRouter(props: StepProps) {
  switch (props.step.type) {
    case 'brief':
      return <BriefStep {...props} />;
    case 'web-page':
      return <WebPageStep {...props} />;
    case 'image':
    case 'video':
    case 'audio':
      return <MediaStep {...props} />;
    case 'social-pack':
      return <SocialPackStep {...props} />;
  }
}

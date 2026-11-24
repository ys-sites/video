import { useI18n } from '../i18n/I18n';
import { Tooltip } from '../components/ui/Tooltip';
import discordLogo from './community-discord.svg';
import feishuLogo from '../../../packages/design-system/brand/community-feishu.svg';

export const discord = { platform: 'Discord', href: 'https://discord.com/invite/M7NnHS9gNa', icon: discordLogo };
export const feishu = { platform: '飞书', href: 'https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=b6cs46dc-acb2-48ed-941d-c45642ead841', icon: feishuLogo };

export function useCommunityLink() {
  const { t, locale } = useI18n();
  const { platform, href, icon } = locale === 'zh-CN' ? feishu : discord;
  return { href, icon, label: t('Join OpenMotion on {platform}', { platform }) };
}

export function CommunityLink() {
  const { href, icon, label } = useCommunityLink();
  return <Tooltip label={label} side="bottom" lines={2}>
    <a className="motion-icon-button motion-community-link" href={href}
      target="_blank" rel="noopener noreferrer" aria-label={label}>
      <img src={icon} width="16" height="16" alt="" />
    </a>
  </Tooltip>;
}

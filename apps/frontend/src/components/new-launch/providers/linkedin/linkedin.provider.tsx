'use client';

import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { Checkbox } from '@gitroom/react/form/checkbox';
import { Input } from '@gitroom/react/form/input';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { LinkedinDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/linkedin.dto';
import { LinkedinPreview } from '@gitroom/frontend/components/new-launch/providers/linkedin/linkedin.preview';
import { useIntegration } from '@gitroom/frontend/components/launches/helpers/use.integration';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';

const LinkedInSettings = () => {
  const t = useT();
  const { watch, register, formState, control } = useSettings();
  const { value } = useIntegration();
  const isCarousel = watch('post_as_images_carousel');
  // An attached PDF is already a carousel, so the images-carousel toggle
  // doesn't apply — but it still needs the title LinkedIn shows on the document.
  const hasPdf = !!value?.[0]?.image?.some((p: any) =>
    hasExtension(p?.path, 'pdf')
  );

  return (
    <div className="mb-[20px]">
      {!hasPdf && (
        <Checkbox
          variant="hollow"
          label={t('post_as_images_carousel', 'Post as images carousel')}
          {...register('post_as_images_carousel', {
            value: false,
          })}
        />
      )}
      {(isCarousel || hasPdf) && (
        <div className={hasPdf ? '' : 'mt-[10px]'}>
          <Input
            label={
              hasPdf
                ? t('document_title', 'Document title (shown on LinkedIn)')
                : t('carousel_name', 'Carousel slide name')
            }
            placeholder="slides"
            {...register('carousel_name')}
          />
        </div>
      )}
    </div>
  );
};
export default withProvider<LinkedinDto>({
  postComment: PostComment.COMMENT,
  minimumCharacters: [],
  SettingsComponent: LinkedInSettings,
  CustomPreviewComponent: LinkedinPreview,
  dto: LinkedinDto,
  maximumCharacters: 3000,
});

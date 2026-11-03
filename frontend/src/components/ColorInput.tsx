import { useId, type ReactNode } from 'react'
import {
  Button as AriaButton,
  ColorArea,
  ColorField,
  ColorPicker,
  ColorSlider,
  ColorSwatch,
  ColorSwatchPicker,
  ColorSwatchPickerItem,
  ColorThumb,
  Dialog,
  DialogTrigger,
  Input,
  Popover,
  SliderTrack,
} from 'react-aria-components'
import { useI18n } from '../i18n'
import { COLOR_PRESETS, NEUTRAL_COLOR, normalizeHex } from '../utils/color'
import styles from './ColorInput.module.css'
import { StaticFieldDescription, StaticFieldError, StaticFieldLabel } from './Field'
import fieldStyles from './Field.module.css'
import overlay from './Overlay.module.css'
import { cx } from './utils'

export interface ColorInputProps {
  label: ReactNode
  /** `#rrggbb` (invalid values show the neutral colour). */
  value: string
  /** Always receives a lower-case `#rrggbb`. */
  onChange: (hex: string) => void
  /** Swatches in the picker (default: category + year palette). */
  presets?: readonly string[]
  description?: ReactNode
  errorMessage?: ReactNode
  isRequired?: boolean
  isDisabled?: boolean
  className?: string
}

/** Colour field: swatch button opening a picker (area + hue + presets) and an editable hex input. */
export function ColorInput({
  label,
  value,
  onChange,
  presets = COLOR_PRESETS,
  description,
  errorMessage,
  isRequired,
  isDisabled,
  className,
}: ColorInputProps) {
  const { t } = useI18n()
  const id = useId()
  const labelId = `${id}-label`
  const descriptionId = description ? `${id}-description` : undefined
  const errorId = errorMessage ? `${id}-error` : undefined
  const current = normalizeHex(value) ?? NEUTRAL_COLOR
  const labelText = typeof label === 'string' ? label : undefined

  return (
    <ColorPicker
      value={current}
      onChange={(color) => {
        const hex = normalizeHex(color.toString('hex'))
        if (hex && hex !== current) onChange(hex)
      }}
    >
      <div
        className={cx(fieldStyles.field, className)}
        role="group"
        aria-labelledby={labelId}
        aria-describedby={[descriptionId, errorId].filter(Boolean).join(' ') || undefined}
        data-invalid={errorMessage ? true : undefined}
      >
        <StaticFieldLabel id={labelId} isRequired={isRequired}>
          {label}
        </StaticFieldLabel>
        <div className={styles.row}>
          <DialogTrigger>
            <AriaButton
              className={styles.swatchButton}
              isDisabled={isDisabled}
              aria-label={labelText ? `${t('components.colorInput.open')}: ${labelText}` : t('components.colorInput.open')}
            >
              <ColorSwatch className={styles.swatch} />
            </AriaButton>
            <Popover className={cx(overlay.popover, styles.popover)} placement="bottom start" offset={8}>
              <Dialog className={styles.dialog} aria-label={labelText ?? t('components.colorInput.open')}>
                <ColorArea
                  className={styles.area}
                  colorSpace="hsb"
                  xChannel="saturation"
                  yChannel="brightness"
                  aria-label={t('components.colorInput.area')}
                >
                  <ColorThumb className={styles.thumb} />
                </ColorArea>
                <ColorSlider className={styles.slider} colorSpace="hsb" channel="hue" aria-label={t('components.colorInput.hue')}>
                  <SliderTrack className={styles.sliderTrack}>
                    <ColorThumb className={cx(styles.thumb, styles.sliderThumb)} />
                  </SliderTrack>
                </ColorSlider>
                {presets.length > 0 && (
                  <ColorSwatchPicker className={styles.presets} aria-label={t('components.colorInput.presets')}>
                    {presets.map((preset) => (
                      <ColorSwatchPickerItem key={preset} color={preset} className={styles.preset}>
                        <ColorSwatch className={styles.presetSwatch} />
                      </ColorSwatchPickerItem>
                    ))}
                  </ColorSwatchPicker>
                )}
              </Dialog>
            </Popover>
          </DialogTrigger>
          <ColorField
            className={cx(fieldStyles.control, styles.hexField)}
            aria-labelledby={labelId}
            aria-description={t('components.colorInput.hex')}
            isDisabled={isDisabled}
            isRequired={isRequired}
            isInvalid={errorMessage ? true : undefined}
          >
            <Input className={cx(fieldStyles.input, styles.hexInput)} spellCheck={false} />
          </ColorField>
        </div>
        <StaticFieldDescription id={descriptionId}>{description}</StaticFieldDescription>
        <StaticFieldError id={errorId}>{errorMessage}</StaticFieldError>
      </div>
    </ColorPicker>
  )
}

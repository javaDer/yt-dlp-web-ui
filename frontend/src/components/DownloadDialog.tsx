import { FileUpload } from '@mui/icons-material'
import CloseIcon from '@mui/icons-material/Close'
import {
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Container,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Select,
  SelectChangeEvent,
  TextField
} from '@mui/material'
import AppBar from '@mui/material/AppBar'
import Dialog from '@mui/material/Dialog'
import Slide from '@mui/material/Slide'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import { TransitionProps } from '@mui/material/transitions'
import { useAtom, useAtomValue } from 'jotai'
import {
  FC,
  Suspense,
  forwardRef,
  useRef,
  useState,
  useTransition
} from 'react'
import {
  cookiesTemplateState,
  customArgsState,
  filenameTemplateState,
  savedTemplatesState
} from '../atoms/downloadTemplate'
import { settingsState } from '../atoms/settings'
import { availableDownloadPathsState, connectedState } from '../atoms/status'
import FormatsGrid from '../components/FormatsGrid'
import { useToast } from '../hooks/toast'
import { useI18n } from '../hooks/useI18n'
import { useRPC } from '../hooks/useRPC'
import type { DLMetadata } from '../types'
import { toFormatArgs } from '../utils'
import CustomArgsTextField from './CustomArgsTextField'
import ExtraDownloadOptions from './ExtraDownloadOptions'
import LoadingBackdrop from './LoadingBackdrop'

const Transition = forwardRef(function Transition(
  props: TransitionProps & {
    children: React.ReactElement
  },
  ref: React.Ref<unknown>,
) {
  return <Slide direction="up" ref={ref} {...props} />
})

type Props = {
  open: boolean
  onClose: () => void
  onDownloadStart: (url: string) => void
}

const DownloadDialog: FC<Props> = ({ open, onClose, onDownloadStart }) => {
  const settings = useAtomValue(settingsState)
  const isConnected = useAtomValue(connectedState)
  const availableDownloadPaths = useAtomValue(availableDownloadPathsState)
  const savedTemplates = useAtomValue(savedTemplatesState)
  const customArgs = useAtomValue(customArgsState)
  const cookies = useAtomValue(cookiesTemplateState)

  const [downloadFormats, setDownloadFormats] = useState<DLMetadata>()
  const [pickedVideoFormat, setPickedVideoFormat] = useState('')
  const [pickedAudioFormat, setPickedAudioFormat] = useState('')
  const [pickedBestFormat, setPickedBestFormat] = useState('')
  const [isFormatsLoading, setIsFormatsLoading] = useState(false)
  const [hasSubtitles, setHasSubtitles] = useState(false)
  const [selectedSubtitleLangs, setSelectedSubtitleLangs] = useState<string[]>([])
  const [availableSubtitleLangs, setAvailableSubtitleLangs] = useState<string[]>([])
  const [selectedSubtitleFormats, setSelectedSubtitleFormats] = useState<Record<string, string>>({}) // New state for selected formats per language

  const [downloadPath, setDownloadPath] = useState('')

  const [filenameTemplate, setFilenameTemplate] = useAtom(
    filenameTemplateState
  )

  const [fileExtension, setFileExtension] = useState('.%(ext)s')

  const [url, setUrl] = useState('')

  const [isPlaylist, setIsPlaylist] = useState(false)

  const { i18n } = useI18n()
  const { client } = useRPC()
  const { pushMessage } = useToast()

  const urlInputRef = useRef<HTMLInputElement>(null)
  const customFilenameInputRef = useRef<HTMLInputElement>(null)

  const [isPending, startTransition] = useTransition()

  /**
    * Retrive url from input, cli-arguments from checkboxes and emits via WebSocket
  */
  const sendUrl = async (immediate?: string) => {
    for (const line of url.split('\n')) {
      const codes = new Array<string>()
      if (pickedVideoFormat !== '') codes.push(pickedVideoFormat)
      if (pickedAudioFormat !== '') codes.push(pickedAudioFormat)
      if (pickedBestFormat !== '') codes.push(pickedBestFormat)

      const downloadTemplate = `${customArgs} ${cookies}`
        .replace(/  +/g, ' ')
        .trim()

      await new Promise(r => setTimeout(r, 10))
      let finalArgs = `${toFormatArgs(codes)} ${downloadTemplate}`

      // Add subtitle arguments if subtitleLangs is provided
      if (selectedSubtitleLangs.length > 0) {
        finalArgs += ` --write-subs`
        // Add specific subtitle languages
        finalArgs += ` --sub-langs ${selectedSubtitleLangs.join(',')}`
        // Add specific subtitle formats if selected
        // Add specific subtitle formats if selected (applies to all selected languages)
        const selectedFormats = Object.values(selectedSubtitleFormats).filter(Boolean)
        if (selectedFormats.length > 0) {
          // Use the first selected format as the preferred format for all
          finalArgs += ` --sub-format ${selectedFormats[0]}`
        }
      } else if (hasSubtitles && selectedSubtitleLangs.length === 0) {
        // If hasSubtitles is true and no specific language is selected, download all subtitles
        finalArgs += ` --write-subs --all-subs`
      }

      client.download({
        url: immediate || line,
        args: finalArgs,
        pathOverride: downloadPath ?? '',
        renameTo: settings.fileRenaming ? filenameTemplate + (settings.autoFileExtension ? fileExtension : '') : '',
        playlist: isPlaylist,
        subtitleLangs: hasSubtitles ? selectedSubtitleLangs : undefined, // Pass subtitle languages to backend
      })

      setTimeout(() => {
        resetInput()
        setDownloadFormats(undefined)
        onDownloadStart(immediate || line)
      }, 100)
    }

    setUrl('')
  }

  /**
   * Retrive url from input and display the formats selection view
   */
  const sendUrlFormatSelection = () => {
    setPickedAudioFormat('')
    setPickedVideoFormat('')
    setPickedBestFormat('')


    if (isPlaylist) {
      pushMessage('Format selection on playlist is not supported', 'warning')
      resetInput()
      onClose()
      return
    }

    setIsFormatsLoading(true)

    client.formats(url)
      ?.then(formats => {
        if (formats.result._type === 'playlist') {
          pushMessage('Format selection on playlist is not supported. Downloading as playlist.', 'info')
          resetInput()
          onClose()
          return
        }
        setDownloadFormats(formats.result)
        resetInput()

        // Check for subtitles
        if (formats.result.subtitles && Object.keys(formats.result.subtitles).length > 0) {
          setHasSubtitles(true)
          setAvailableSubtitleLangs(Object.keys(formats.result.subtitles))
          pushMessage('视频有可用字幕。', 'info')
        } else {
          setHasSubtitles(false)
          setAvailableSubtitleLangs([])
          pushMessage('视频没有可用字幕。', 'info')
        }
      })
      .then(() => setIsFormatsLoading(false))
  }

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUrl(e.target.value)
  }

  const handleFilenameTemplateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFilenameTemplate(e.target.value)
  }

  const handleFileExtensionChange = (e: SelectChangeEvent<string>) => {
    setFileExtension(e.target.value)
  }

  const parseUrlListFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.currentTarget.files
    if (!files || files.length < 1) {
      return
    }

    const file = await files[0].text()

    file
      .split('\n')
      .forEach(u => sendUrl(u))
  }

  const resetInput = () => {
    urlInputRef.current!.value = ''
    if (customFilenameInputRef.current) {
      customFilenameInputRef.current!.value = ''
    }
  }

  return (
    <Dialog
      fullScreen
      open={open}
      onClose={onClose}
      TransitionComponent={Transition}
    >
      <LoadingBackdrop isLoading={isPending || isFormatsLoading} />
      <AppBar sx={{ position: 'relative' }}>
        <Toolbar>
          <IconButton
            edge="start"
            color="inherit"
            onClick={onClose}
            aria-label="close"
          >
            <CloseIcon />
          </IconButton>
          <Typography sx={{ ml: 2, flex: 1 }} variant="h6" component="div">
            Download
          </Typography>
        </Toolbar>
      </AppBar>
      <Box sx={{
        backgroundColor: (theme) => theme.palette.background.default,
        minHeight: (theme) => `calc(99vh - ${theme.mixins.toolbar.minHeight}px)`
      }}>
        <Container sx={{ my: 4 }}>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <Paper
                elevation={4}
                sx={{
                  p: 2,
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <Grid container>
                  <TextField
                    multiline
                    fullWidth
                    ref={urlInputRef}
                    label={i18n.t('urlInput')}
                    variant="outlined"
                    onChange={handleUrlChange}
                    disabled={
                      !isConnected
                      || (settings.formatSelection && downloadFormats != null)
                    }
                    InputProps={{
                      endAdornment: (
                        <InputAdornment position="end">
                          <label htmlFor="icon-button-file">
                            <input
                              hidden
                              id="icon-button-file"
                              type="file"
                              accept=".txt"
                              onChange={e => parseUrlListFile(e)}
                            />
                            <IconButton
                              color="primary"
                              aria-label="upload file"
                              component="span"
                            >
                              <FileUpload />
                            </IconButton>
                          </label>
                        </InputAdornment>
                      ),
                    }}
                  />
                </Grid>
                <Grid container spacing={1} sx={{ mt: 1 }}>
                  {settings.enableCustomArgs &&
                    <Grid item xs={12}>
                      <CustomArgsTextField />
                    </Grid>
                  }
                  {
                    settings.fileRenaming &&
                    <Grid item xs={
                      !settings.autoFileExtension && !settings.pathOverriding
                        ? 12
                        : !settings.autoFileExtension && settings.pathOverriding
                          ? 8
                          : settings.autoFileExtension && !settings.pathOverriding
                            ? 10
                            : 6
                    }>
                      <TextField
                        sx={{ mt: 1 }}
                        ref={customFilenameInputRef}
                        fullWidth
                        label={i18n.t('customFilename')}
                        variant="outlined"
                        value={filenameTemplate}
                        onChange={handleFilenameTemplateChange}
                        disabled={
                          !isConnected ||
                          (settings.formatSelection && downloadFormats != null)
                        }
                      />
                    </Grid>
                  }
                  {
                    settings.autoFileExtension &&
                    <Grid item xs={2}>
                      <Select
                        sx={{ mt: 1 }}
                        fullWidth
                        label={i18n.t('autoFileExtension')}
                        value={fileExtension}
                        onChange={handleFileExtensionChange}
                        variant="outlined">
                        <MenuItem value=".%(ext)s">Auto</MenuItem>
                        <MenuItem value=".mp4">mp4</MenuItem>
                        <MenuItem value=".mkv">mkv</MenuItem>
                      </Select>
                    </Grid>
                  }
                  {
                    settings.pathOverriding &&
                    <Grid item xs={4}>
                      <FormControl fullWidth>
                        <Autocomplete
                          disablePortal
                          options={availableDownloadPaths.map((dir) => ({ label: dir, dir }))}
                          autoHighlight
                          getOptionLabel={(option) => option.label}
                          onChange={(_, value) => {
                            setDownloadPath(value?.dir!)
                          }}
                          renderOption={(props, option) => (
                            <Box
                              component="li"
                              sx={{ '& > img': { mr: 2, flexShrink: 0 } }}
                              {...props}>
                              {option.label}
                            </Box>
                          )}
                          sx={{ width: '100%', mt: 1 }}
                          renderInput={(params) => <TextField {...params} label={i18n.t('customPath')} />}
                        />
                      </FormControl>
                    </Grid>
                  }
                </Grid>
                <Suspense>
                  {savedTemplates.length > 0 && <ExtraDownloadOptions />}
                </Suspense>
                <Grid container spacing={1} pt={2} justifyContent="space-between">
                  <Grid item>
                    <Grid item>
                      <FormControlLabel
                        control={<Checkbox onChange={() => setIsPlaylist(state => !state)} />}
                        checked={isPlaylist}
                        label={i18n.t('playlistCheckbox')}
                      />
                    </Grid>
                  </Grid>
                  <Grid item>
                    <Button
                      variant="contained"
                      disabled={url === ''}
                      onClick={() => settings.formatSelection
                        ? startTransition(() => sendUrlFormatSelection())
                        : startTransition(async () => await sendUrl())
                      }
                    >
                      {
                        settings.formatSelection
                          ? i18n.t('selectFormatButton')
                          : i18n.t('startButton')
                      }
                    </Button>
                  </Grid>
                </Grid>
              </Paper>
            </Grid>
          </Grid >
          {/* Subtitle Selection */}
          {hasSubtitles && (
            <Paper
              elevation={4}
              sx={{
                p: 2,
                display: 'flex',
                flexDirection: 'column',
                mt: 2,
              }}
            >
              <Typography variant="h6" gutterBottom>
                字幕选项
              </Typography>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={selectedSubtitleLangs.length > 0 || (hasSubtitles && availableSubtitleLangs.length === 0)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        // If checked, and there are available languages, select all by default
                        if (availableSubtitleLangs.length > 0) {
                          setSelectedSubtitleLangs(availableSubtitleLangs)
                        } else {
                          // If no specific languages are available, but hasSubtitles is true,
                          // it implies downloading all available (e.g., auto-generated)
                          setSelectedSubtitleLangs([])
                        }
                      } else {
                        setSelectedSubtitleLangs([])
                      }
                    }}
                  />
                }
                label="下载字幕"
              />
              {availableSubtitleLangs.length > 0 && (
                <FormControl fullWidth sx={{ mt: 1 }}>
                  <Autocomplete
                    multiple
                    options={availableSubtitleLangs}
                    getOptionLabel={(option) => option}
                    value={selectedSubtitleLangs}
                    onChange={(_, newValue) => {
                      setSelectedSubtitleLangs(newValue)
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        variant="outlined"
                        label="选择字幕语言"
                        placeholder="语言"
                      />
                    )}
                  />
                </FormControl>
              )}
              {hasSubtitles && availableSubtitleLangs.length > 0 && (
                <Box sx={{ mt: 2 }}>
                  {availableSubtitleLangs.map((lang) => (
                    <FormControl fullWidth key={lang} sx={{ mt: 1 }}>
                      <Typography variant="subtitle2">{lang}</Typography>
                      <Select
                        value={selectedSubtitleFormats[lang] || ''}
                        onChange={(e) => {
                          setSelectedSubtitleFormats((prev) => ({
                            ...prev,
                            [lang]: e.target.value,
                          }))
                        }}
                        displayEmpty
                        inputProps={{ 'aria-label': 'Without label' }}
                      >
                        <MenuItem value="">
                          <em>自动选择最佳格式</em>
                        </MenuItem>
                        {downloadFormats?.subtitles?.[lang]?.map((subFormat) => (
                          <MenuItem key={subFormat.ext} value={subFormat.ext}>
                            {subFormat.ext}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  ))}
                </Box>
              )}
            </Paper>
          )}

          {/* Format Selection grid */}
          {downloadFormats && <FormatsGrid
            downloadFormats={downloadFormats}
            onBestQualitySelected={(id) => {
              setPickedBestFormat(id)
              setPickedVideoFormat('')
              setPickedAudioFormat('')
            }}
            onVideoSelected={(id) => {
              setPickedVideoFormat(id)
              setPickedBestFormat('')
            }}
            onAudioSelected={(id) => {
              setPickedAudioFormat(id)
              setPickedBestFormat('')
            }}
            onClear={() => {
              setPickedAudioFormat('')
              setPickedVideoFormat('')
              setPickedBestFormat('')
            }}
            onSubmit={sendUrl}
            pickedBestFormat={pickedBestFormat}
            pickedVideoFormat={pickedVideoFormat}
            pickedAudioFormat={pickedAudioFormat}
          />}
        </Container>
      </Box>
    </Dialog>
  )
}

export default DownloadDialog
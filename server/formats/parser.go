package formats

import (
	"encoding/json"
	"log/slog"
	"os/exec"
	"sync"

	"github.com/marcopiovanello/yt-dlp-web-ui/v3/server/config"
)

func ParseURL(url string) (*Metadata, error) {
	cmd := exec.Command(config.Instance().DownloaderPath, url, "-J")

	stdout, err := cmd.Output()
	if err != nil {
		slog.Error("failed to retrieve metadata", slog.String("err", err.Error()))
		return nil, err
	}

	slog.Info(
		"retrieving metadata",
		slog.String("caller", "getFormats"),
		slog.String("url", url),
	)

	info := &Metadata{URL: url}
	best := &Format{}

	var (
		wg            sync.WaitGroup
		decodingError error
	)

	wg.Add(2)

	go func() {
		var raw map[string]interface{}
		if err := json.Unmarshal(stdout, &raw); err != nil {
			decodingError = err
			wg.Done()
			return
		}

		// Unmarshal into Metadata struct
		if err := json.Unmarshal(stdout, &info); err != nil {
			decodingError = err
			wg.Done()
			return
		}

		// Manually unmarshal subtitles to handle dynamic keys
		if subs, ok := raw["subtitles"].(map[string]interface{}); ok {
			info.Subtitles = make(map[string][]SubtitleFormat)
			for lang, formats := range subs {
				if formatList, ok := formats.([]interface{}); ok {
					var sfs []SubtitleFormat
					for _, f := range formatList {
						if sfMap, ok := f.(map[string]interface{}); ok {
							sf := SubtitleFormat{}
							if ext, ok := sfMap["ext"].(string); ok {
								sf.Ext = ext
							}
							if url, ok := sfMap["url"].(string); ok {
								sf.URL = url
							}
							// yt-dlp does not provide a 'name' field for subtitles directly in this structure,
							// so we can use the language code as a fallback or leave it empty.
							sf.Name = lang // Using language code as name for now
							sfs = append(sfs, sf)
						}
					}
					info.Subtitles[lang] = sfs
				}
			}
		}
		wg.Done()
	}()

	go func() {
		decodingError = json.Unmarshal(stdout, &best)
		wg.Done()
	}()

	wg.Wait()

	if decodingError != nil {
		return nil, err
	}

	info.Best = *best

	return info, nil
}

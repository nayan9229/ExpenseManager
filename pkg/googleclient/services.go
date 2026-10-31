package googleclient

import (
	"context"
	"fmt"
	"sync"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/drive/v3"
	"google.golang.org/api/option"
	"google.golang.org/api/sheets/v4"
)

// Services are the two Google APIs the app talks to, sharing one OAuth client.
type Services struct {
	Drive  *drive.Service
	Sheets *sheets.Service
}

// scopes match what SETUP_GUIDE.md mints the refresh token with. `drive.file`
// would be narrower but cannot write into a folder the app did not create
// (docs/research/drive-resumable-upload-and-private-file-access.md, answer 7).
var scopes = []string{drive.DriveScope, sheets.SpreadsheetsScope}

// tokenSources caches one refreshing token source per refresh token, so a
// warm function reuses its access token instead of refreshing on every call.
var tokenSources struct {
	sync.Mutex
	byToken map[string]oauth2.TokenSource
}

// NewServices builds Drive and Sheets services that authenticate with the
// refresh token in cfg. No network call happens until the first API request.
func NewServices(ctx context.Context, cfg Config) (Services, error) {
	oc := &oauth2.Config{
		ClientID:     cfg.ClientID,
		ClientSecret: cfg.ClientSecret,
		Endpoint:     google.Endpoint,
		Scopes:       scopes,
	}
	client := oauth2.NewClient(ctx, tokenSource(oc, cfg.RefreshToken))
	driveSvc, err := drive.NewService(ctx, option.WithHTTPClient(client))
	if err != nil {
		return Services{}, fmt.Errorf("googleclient: drive: %w", err)
	}
	sheetsSvc, err := sheets.NewService(ctx, option.WithHTTPClient(client))
	if err != nil {
		return Services{}, fmt.Errorf("googleclient: sheets: %w", err)
	}
	return Services{Drive: driveSvc, Sheets: sheetsSvc}, nil
}

func tokenSource(oc *oauth2.Config, refreshToken string) oauth2.TokenSource {
	tokenSources.Lock()
	defer tokenSources.Unlock()
	key := oc.ClientID + "\x00" + refreshToken
	if ts, ok := tokenSources.byToken[key]; ok {
		return ts
	}
	if tokenSources.byToken == nil {
		tokenSources.byToken = map[string]oauth2.TokenSource{}
	}
	// Background context: the cached source outlives any one request.
	ts := oc.TokenSource(context.Background(), &oauth2.Token{RefreshToken: refreshToken})
	tokenSources.byToken[key] = ts
	return ts
}

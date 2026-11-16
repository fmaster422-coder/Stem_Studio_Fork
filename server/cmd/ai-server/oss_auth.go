
package main

import (
	"context"
	"crypto/subtle"
	"net/http"
	"os"

	"github.com/dotErth/ai-3d-sandbox/stemstudio/logger"
	"github.com/dotErth/ai-3d-sandbox/stemstudio/server/constants"
)

const ossUserID = "stemstudio-local-user"

type ossLocalIdentity struct {
	UID string
}

// ossAuthMiddleware authenticates requests using a server-side secret.
// The secret must be configured through AI_SERVER_TOKEN.
func ossAuthMiddleware(w http.ResponseWriter, r *http.Request, next http.HandlerFunc) {
	// Keep the health endpoint public for hosting-platform health checks.
	if r.Method == http.MethodGet && r.URL.Path == "/" {
		next(w, r)
		return
	}

	expectedToken := os.Getenv("AI_SERVER_TOKEN")
	if expectedToken == "" {
		http.Error(w, "AI server authentication is not configured", http.StatusServiceUnavailable)
		return
	}

	receivedToken := r.Header.Get("Authorization")
	const bearerPrefix = "Bearer "

	if len(receivedToken) < len(bearerPrefix) ||
		receivedToken[:len(bearerPrefix)] != bearerPrefix {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	receivedToken = receivedToken[len(bearerPrefix):]

	if len(receivedToken) != len(expectedToken) ||
		subtle.ConstantTimeCompare([]byte(receivedToken), []byte(expectedToken)) != 1 {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	params := map[string]interface{}{
		"token":     &ossLocalIdentity{UID: ossUserID},
		"authority": constants.User,
		"isAdmin":   true,
	}

	ctx := context.WithValue(r.Context(), "auth_params", params)
	ctx = logger.AddUserIDToContext(ctx, ossUserID)

	next(w, r.WithContext(ctx))
}

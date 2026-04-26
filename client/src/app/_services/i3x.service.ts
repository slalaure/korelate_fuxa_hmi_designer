import { Injectable, NgZone } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { EndPointApi } from '../_helpers/endpointapi';

@Injectable({
    providedIn: 'root'
})
export class I3xService {
    // Korelate Server (Proxied via proxy.conf.json in dev, or NGINX in prod)
    private endPointConfig: string = '';
    // API Key for I3X authentication
    private apiKey: string = 'krl_1536c0405d28bf5fc5069e13cbba2e139d44b8f84adb84746640870824abebcb';

    constructor(private http: HttpClient, private zone: NgZone) { }

    private getHeaders(): HttpHeaders {
        return new HttpHeaders({
            'x-api-key': this.apiKey
        });
    }

    /**
     * Get root elements or elements of a specific type
     */
    getObjects(typeId?: string): Observable<any[]> {
        let url = `${this.endPointConfig}/api/i3x/objects`;
        if (typeId) {
            url += `?typeId=${typeId}`;
        }
        return this.http.get<any[]>(url, { headers: this.getHeaders() });
    }

    /**
     * Get related elements for a specific element ID (Dynamic Graph Navigation)
     */
    getRelatedObjects(elementId: string, relationshipType?: string): Observable<any[]> {
        let url = `${this.endPointConfig}/api/i3x/objects/${elementId}/related`;
        if (relationshipType) {
            url += `?relationshiptype=${relationshipType}`;
        }
        return this.http.get<any[]>(url, { headers: this.getHeaders() });
    }

    /**
     * Get Last Known Values for specific elements.
     */
    getValues(elementIds: string[]): Observable<any> {
        return this.http.post<any>(`${this.endPointConfig}/api/i3x/objects/value`, { elementIds, maxDepth: 1 }, { headers: this.getHeaders() });
    }

    /**
     * Create an I3X Subscription and return a stream of updates via SSE
     * Uses fetch API instead of EventSource to allow passing x-api-key header.
     */
    getRealTimeStream(elementIds: string[]): Observable<any> {
        return new Observable(observer => {
            const controller = new AbortController();
            const signal = controller.signal;
            let subId: string = null;

            console.log(`I3X SSE: Creating subscription for ${elementIds.length} elements...`);

            // 1. Create the subscription
            this.http.post<any>(`${this.endPointConfig}/api/i3x/subscriptions`, {}, { headers: this.getHeaders() }).subscribe(
                sub => {
                    subId = sub.subscriptionId;
                    console.log(`I3X SSE: Subscription created: ${subId}. Registering elements...`);
                    
                    // 2. Register elements
                    this.http.post(`${this.endPointConfig}/api/i3x/subscriptions/${subId}/register`, { elementIds }, { headers: this.getHeaders() }).subscribe(
                        () => {
                            console.log(`I3X SSE: Elements registered. Opening stream...`);
                            
                            // 3. Open SSE Stream via fetch
                            fetch(`${this.endPointConfig}/api/i3x/subscriptions/${subId}/stream`, {
                                headers: {
                                    'x-api-key': this.apiKey,
                                    'Accept': 'text/event-stream'
                                },
                                signal
                            }).then(async response => {
                                if (!response.ok) {
                                    throw new Error(`I3X SSE HTTP error! status: ${response.status}`);
                                }
                                console.log(`I3X SSE: Stream connected! Listening for updates...`);
                                
                                const reader = response.body.getReader();
                                const decoder = new TextDecoder('utf-8');
                                let buffer = '';

                                let messageCount = 0;
                                while (true) {
                                    const { value, done } = await reader.read();
                                    if (done) {
                                        console.log('I3X SSE: Stream closed by server.');
                                        break;
                                    }
                                    
                                    buffer += decoder.decode(value, { stream: true });
                                    
                                    // SSE events are separated by double newlines (can be \n\n or \r\n\r\n)
                                    const parts = buffer.split(/\n\n|\r\n\r\n/);
                                    buffer = parts.pop() || ''; // Keep the last incomplete part

                                    for (const part of parts) {
                                        const lines = part.split(/\n|\r\n/);
                                        for (const line of lines) {
                                            if (line.trim().startsWith('data:')) {
                                                const dataStr = line.replace('data:', '').trim();
                                                if (dataStr) {
                                                    messageCount++;
                                                    this.zone.run(() => {
                                                        try {
                                                            const dataObj = JSON.parse(dataStr);
                                                            if (messageCount % 10 === 0) console.log(`I3X SSE: Received ${messageCount} updates so far...`);
                                                            observer.next(dataObj);
                                                        } catch (e) {
                                                            console.error('I3X SSE: JSON parse error:', e, 'Raw:', dataStr);
                                                        }
                                                    });
                                                }
                                            }
                                        }
                                    }
                                }
                            }).catch(error => {
                                if (error.name === 'AbortError') {
                                    console.log('I3X SSE: Stream aborted intentionally (cleanup).');
                                } else {
                                    console.error('I3X SSE: Stream error:', error);
                                    this.zone.run(() => observer.error(error));
                                }
                            });
                        },
                        error => {
                            console.error('I3X SSE: Failed to register elements', error);
                            this.zone.run(() => observer.error(error));
                        }
                    );
                },
                error => {
                    console.error('I3X SSE: Failed to create subscription', error);
                    this.zone.run(() => observer.error(error));
                }
            );

            // Cleanup on unsubscribe
            return () => {
                console.log(`I3X SSE: Unsubscribing... Cleaning up subId: ${subId}`);
                controller.abort();
                if (subId) {
                    this.http.delete(`${this.endPointConfig}/api/i3x/subscriptions/${subId}`, { headers: this.getHeaders() }).subscribe();
                }
            };
        });
    }

    /**
     * Search an UNS Concept
     */
    searchConcept(concept: string): Observable<any> {
        return this.http.post<any>(`${this.endPointConfig}/api/i3x/search`, { concept }, { headers: this.getHeaders() });
    }
}

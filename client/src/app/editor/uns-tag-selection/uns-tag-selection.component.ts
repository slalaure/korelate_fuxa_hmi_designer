import { Component, Inject, OnInit, OnDestroy } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NestedTreeControl } from '@angular/cdk/tree';
import { MatTreeNestedDataSource } from '@angular/material/tree';
import { DeviceTagSelectionData } from '../../device/device-tag-selection/device-tag-selection.component';
import { I3xService } from '../../_services/i3x.service';
import { Subject, takeUntil } from 'rxjs';

export interface UnsNode {
    id: string; // elementId in I3X
    name: string; // displayName in I3X
    typeId?: string;
    isComposition?: boolean;
    children?: UnsNode[];
    loaded?: boolean;
    value?: any;
    unit?: string;
}

@Component({
    selector: 'app-uns-tag-selection',
    templateUrl: './uns-tag-selection.component.html',
    styleUrls: ['./uns-tag-selection.component.scss']
})
export class UnsTagSelectionComponent implements OnInit, OnDestroy {
    treeControl = new NestedTreeControl<UnsNode>(node => node.children);
    dataSource = new MatTreeNestedDataSource<UnsNode>();
    
    private destroy$ = new Subject<void>();
    private activeSubscriptions: string[] = [];
    private streamSubscription: any;

    constructor(
        public dialogRef: MatDialogRef<UnsTagSelectionComponent>,
        @Inject(MAT_DIALOG_DATA) public data: DeviceTagSelectionData,
        private i3xService: I3xService
    ) {}

    ngOnInit() {
        this.loadRootObjects();
    }

    ngOnDestroy() {
        if (this.streamSubscription) {
            this.streamSubscription.unsubscribe();
        }
        this.destroy$.next();
        this.destroy$.complete();
    }

    hasChild = (_: number, node: UnsNode) => !!node.children && node.children.length > 0;

    /**
     * Load initial objects and build the tree hierarchy locally.
     */
    private loadRootObjects() {
        console.log('UNS Browser: Fetching objects...');
        this.i3xService.getObjects().pipe(takeUntil(this.destroy$)).subscribe(
            (objects) => {
                console.log('UNS Browser: Received objects', objects);
                
                // Build a map of all nodes
                const nodeMap = new Map<string, UnsNode>();
                objects.forEach(obj => {
                    nodeMap.set(obj.elementId, {
                        id: obj.elementId,
                        name: obj.displayName || obj.elementId,
                        typeId: obj.typeId,
                        isComposition: obj.isComposition,
                        children: [],
                        loaded: true
                    });
                });

                // Link children to parents
                const rootNodes: UnsNode[] = [];
                objects.forEach(obj => {
                    const node = nodeMap.get(obj.elementId);
                    if (obj.parentId && nodeMap.has(obj.parentId)) {
                        nodeMap.get(obj.parentId).children.push(node);
                    } else {
                        rootNodes.push(node);
                    }
                });
                
                this.dataSource.data = rootNodes;
                this.updateSSE();
            },
            (err) => {
                console.error('UNS Browser: Error fetching I3X objects:', err);
                this.dataSource.data = [];
            }
        );
    }

    // Remove the unused loadChildren method

    /**
     * Process an incoming value. If it's a complex JSON object, expand it into child nodes.
     */
    private processNodeValue(node: UnsNode, value: any, unit?: string): boolean {
        let changed = false;
        if (typeof value === 'object' && value !== null) {
            // It's a complex JSON object
            if (node.value !== '{...}') {
                node.value = '{...}';
                changed = true;
            }
            node.unit = '';
            
            if (!node.children) {
                node.children = [];
                changed = true;
            }
            
            const currentKeys = node.children.map(c => c.name);
            const newKeys = Object.keys(value);
            
            // Rebuild children if keys differ
            if (JSON.stringify(currentKeys) !== JSON.stringify(newKeys)) {
                node.children = newKeys.map(key => ({
                    id: `${node.id}.${key}`,
                    name: key,
                    value: (typeof value[key] === 'object' && value[key] !== null) ? JSON.stringify(value[key]) : value[key],
                    isComposition: false,
                    loaded: true
                }));
                changed = true;
            } else {
                // Just update values
                node.children.forEach(child => {
                    const newValue = (typeof value[child.name] === 'object' && value[child.name] !== null) ? JSON.stringify(value[child.name]) : value[child.name];
                    if (child.value !== newValue) {
                        child.value = newValue;
                        changed = true;
                    }
                });
            }
        } else {
            // Primitive value
            if (node.value !== value || node.unit !== unit) {
                node.value = value;
                node.unit = unit;
                changed = true;
            }
        }
        return changed;
    }

    /**
     * Update the list of elements we want to track in real-time.
     * We track all currently visible (loaded) non-composition nodes.
     */
    private updateSSE() {
        const leafIds: string[] = [];
        const findLeaves = (nodes: UnsNode[]) => {
            nodes.forEach(n => {
                // Subscribe only to real I3X objects (no sub-properties containing dots)
                if (!n.isComposition && n.id !== 'loading' && !n.id.includes('.')) {
                    leafIds.push(n.id);
                }
                if (n.children && n.children.length > 0 && n.id !== 'loading') {
                    findLeaves(n.children);
                }
            });
        };
        findLeaves(this.dataSource.data);

        // If subscription list changed, restart stream
        if (JSON.stringify(leafIds.sort()) !== JSON.stringify(this.activeSubscriptions.sort())) {
            this.activeSubscriptions = leafIds;
            if (this.streamSubscription) {
                this.streamSubscription.unsubscribe();
            }
            if (this.activeSubscriptions.length > 0) {
                // Fetch initial Last Known Value immediately
                this.i3xService.getValues(this.activeSubscriptions).pipe(takeUntil(this.destroy$)).subscribe(
                    valuesObj => {
                        let changed = false;
                        for (const elementId in valuesObj) {
                            if (valuesObj[elementId] && valuesObj[elementId].data && valuesObj[elementId].data.length > 0) {
                                const vqtData = valuesObj[elementId].data[0];
                                if (vqtData && vqtData.value !== undefined) {
                                    const node = this.findNodeById(this.dataSource.data, elementId);
                                    if (node) {
                                        if (this.processNodeValue(node, vqtData.value, vqtData.engUnit)) {
                                            changed = true;
                                        }
                                    }
                                }
                            }
                        }
                        if (changed) this.refreshTree();
                    }
                );

                // Start SSE stream
                this.streamSubscription = this.i3xService.getRealTimeStream(this.activeSubscriptions)
                    .pipe(takeUntil(this.destroy$))
                    .subscribe(updates => {
                        this.applyUpdates(updates);
                    });
            }
        }
    }

    private applyUpdates(updates: any[]) {
        let changed = false;
        updates.forEach(update => {
            for (const elementId in update) {
                const vqtData = update[elementId].data ? update[elementId].data[0] : null;
                if (vqtData && vqtData.value !== undefined) {
                    const node = this.findNodeById(this.dataSource.data, elementId);
                    if (node) {
                        if (this.processNodeValue(node, vqtData.value, vqtData.engUnit)) {
                            changed = true;
                        }
                    }
                }
            }
        });
        if (changed) {
            this.refreshTree();
        }
    }

    private findNodeById(nodes: UnsNode[], id: string): UnsNode | null {
        for (const n of nodes) {
            if (n.id === id) return n;
            if (n.children) {
                const found = this.findNodeById(n.children, id);
                if (found) return found;
            }
        }
        return null;
    }

    private refreshTree() {
        const data = this.dataSource.data;
        this.dataSource.data = []; // Fix: Assign empty array instead of null
        this.dataSource.data = data;
    }

    onSelect(node: UnsNode) {
        if (!node.isComposition && node.id !== 'loading') {
            this.data.variableId = node.id;
            this.data.variablesId = [node.id];
            this.dialogRef.close(this.data);
        } else {
            this.treeControl.toggle(node);
        }
    }

    onNoClick(): void {
        this.dialogRef.close();
    }

    onOkClick(): void {
        this.dialogRef.close(this.data);
    }
}

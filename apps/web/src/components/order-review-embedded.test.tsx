// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { Recommendation } from '@/lib/types';
import { OrderReviewView } from './order-review-view';
vi.mock('./workbench-grid',()=>({WorkbenchGrid:({onEditReplenishment}:{onEditReplenishment:(row:Recommendation)=>void})=> <div>Wine editing grid<button onClick={()=>onEditReplenishment({id:'wine',product_code:'WINE',product_name:'Wine',replenishment_policy:'Core',recommendations_suppressed:false} as Recommendation)}>Edit policy</button></div>}));
it('renders a supplier editor directly without a duplicate overview, filters or disclosure',async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  const host=document.createElement('div');const root=createRoot(host);
  const noop=vi.fn();
  const props={canManageMarkers:true,workbenchOnly:true, brandManager:'All',brandManagerOptions:['All'],expandAll:false,search:'',suggestedOnly:false,supplier:'All',supplierSort:'default',
    replenishmentPolicyFilter:'All',supplierOptions:['All'], supplierCatalogWines:[],salesReferenceDate:'2026-09-26',supplierTargetWeeks:{},globalTargetWeeks:'',visibleCount:1,
    approvalEvents:[],auditActorNames:{},isPending:false,isCatalogSaving:false,deletingCatalogWineId:null,
    metrics:{urgent:0,low:0,recommendedBottles:12,approvedBottles:0,poValue:0,supplierCount:1},
    supplierGroups:[{supplier:'Example',rows:[],skuCount:1,urgentCount:0,freeGoodProgramCount:0,recommendedBottles:12,approvedBottles:0,suggestedValue:120,approvedValue:0}],
    setBrandManager:noop,setExpandAll:noop,setSearch:noop,setSuggestedOnly:noop,setSupplier:noop,setSupplierSort:noop,setReplenishmentPolicyFilter:noop,
    onSaveApproval:noop,onSaveOrderPath:noop,onSaveWorkingQty:noop,onSetWorkingQty:noop,onSetSupplierTargetWeeks:noop,onSetGlobalTargetWeeks:noop,onRestoreInactiveWine:noop,onSaveCatalogWine:noop,onDeleteCatalogWine:noop,onAddWine:noop,onSaveReplenishmentPolicy:async()=>{}
  } satisfies ComponentProps<typeof OrderReviewView>;
  await act(async()=>root.render(<OrderReviewView {...props}/>));
  expect(host.querySelector('h1')).toBeNull();
  expect(host.querySelector('input[placeholder="Wine, supplier, item #"]')).toBeNull();
  expect(host.querySelector('details')).toBeNull();
  expect(host.textContent).not.toContain('Order Summary');
  expect(host.textContent).toContain('Wine editing grid');
  expect(host.textContent).toContain('Target weeks');
  await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='Edit policy')!.click());
  const dialog=host.querySelector('[role="dialog"]')!;
  expect((dialog.querySelector('select') as HTMLSelectElement).disabled).toBe(false);
  expect((dialog.querySelector('input[type="checkbox"]') as HTMLInputElement).disabled).toBe(false);
  expect(dialog.textContent).not.toContain('You do not have permission');
  for (const policy of ['Limited', 'Allocated', 'Special Order', 'Limited Core', 'Core']) {
    await act(async()=>{const select=dialog.querySelector('select')!;select.value=policy;select.dispatchEvent(new Event('change',{bubbles:true}));});
    const automatic=policy==='Core'||policy==='Limited Core';
    expect(Boolean(dialog.querySelector('input[type="checkbox"]'))).toBe(automatic);
    expect(dialog.textContent?.includes('Manual ordering only')).toBe(!automatic);
  }
  await act(async()=>root.render(<OrderReviewView {...props} canManageMarkers={false}/>));
  expect((dialog.querySelector('select') as HTMLSelectElement).disabled).toBe(true);
  expect((dialog.querySelector('input[type="checkbox"]') as HTMLInputElement).disabled).toBe(true);
  await act(async()=>root.unmount());
});

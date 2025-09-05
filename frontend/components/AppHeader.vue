<template>
  <Menubar :model="menuItems" class="header-menubar">
    <template #start>
      <NuxtLink to="/" class="brand-link">
        <span class="brand-text">nona-metadata</span>
      </NuxtLink>
    </template>
  </Menubar>
</template>

<script setup>
import Menubar from "primevue/menubar";

const menuItems = [
  {
    label: "Home",
    icon: "pi pi-home",
    to: "/",
  },
  {
    label: "Files",
    icon: "pi pi-folder",
    to: "/files",
  },
  {
    label: "Jobs",
    icon: "pi pi-cog",
    to: "/processing-jobs",
  },
  {
    label: "Cache",
    icon: "pi pi-database",
    to: "/cache",
  },
];
</script>

<style scoped>
.header-menubar {
  padding: 0.5rem 1rem;
}
.brand-link {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: bold;
  font-size: 1.25rem;
  text-decoration: none;
}
.brand-text {
  margin-left: 0.5rem;
}
:deep(.p-menubar .p-menubar-start) {
  margin-right: auto;
}
:deep(.p-menubar .p-menuitem-link) {
  padding: 0.75rem 1rem;
  border-radius: 6px;
}
:deep(.p-menubar .p-menuitem-icon) {
  margin-right: 0.5rem;
}
</style>

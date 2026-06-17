import { Body, Controller, Delete, Get, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { AdminService } from "./admin.service";

@Controller("api/admin")
@UseGuards(AuthGuard, RolesGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("users")
  @Roles("superadmin", "executive")
  listUsers() {
    return this.admin.listUsers();
  }

  @Post("users")
  @Roles("superadmin")
  createUser(@Body() body: unknown) {
    return this.admin.createUser(body as any);
  }

  @Patch("users")
  @Roles("superadmin")
  updateUser(@Body() body: unknown) {
    return this.admin.updateUser(body as any);
  }

  @Delete("users")
  @Roles("superadmin")
  deleteUser(@Query("id") id?: string) {
    return this.admin.deleteUser(id);
  }

  @Get("mapping")
  @Roles("superadmin", "executive", "district_manager")
  listMapping() {
    return this.admin.listMapping();
  }

  @Post("mapping")
  @Roles("superadmin", "executive")
  upsertMapping(@Body() body: unknown) {
    return this.admin.upsertMapping(body as any);
  }

  @Patch("mapping")
  @Roles("superadmin", "executive")
  patchMapping(@Body() body: unknown) {
    return this.admin.upsertMapping(body as any);
  }

  @Delete("mapping")
  @Roles("superadmin", "executive")
  deleteMapping(@Query("staff_id") staffId?: string, @Query("branch_id") branchId?: string) {
    return this.admin.deleteMapping(staffId, branchId);
  }
}

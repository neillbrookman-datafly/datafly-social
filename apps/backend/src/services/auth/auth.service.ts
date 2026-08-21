import { Injectable } from '@nestjs/common';
import { Provider, User } from '@prisma/client';
import { CreateOrgUserDto } from '@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto';
import { LoginUserDto } from '@gitroom/nestjs-libraries/dtos/auth/login.user.dto';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { AuthService as AuthChecker } from '@gitroom/helpers/auth/auth.service';
import { AuthProviderManager } from '@gitroom/backend/services/auth/providers/providers.manager';
import dayjs from 'dayjs';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { ForgotReturnPasswordDto } from '@gitroom/nestjs-libraries/dtos/auth/forgot-return.password.dto';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';
import { NewsletterService } from '@gitroom/nestjs-libraries/newsletter/newsletter.service';

@Injectable()
export class AuthService {
  constructor(
    private _userService: UsersService,
    private _organizationService: OrganizationService,
    private _notificationService: NotificationService,
    private _emailService: EmailService,
    private _providerManager: AuthProviderManager
  ) {}
  async canRegister(provider: string) {
    if (
      process.env.DISABLE_REGISTRATION !== 'true' ||
      provider === Provider.GENERIC
    ) {
      return true;
    }

    return (await this._organizationService.getCount()) === 0;
  }

  async routeAuth(
    provider: Provider,
    body: CreateOrgUserDto | LoginUserDto,
    ip: string,
    userAgent: string,
    addToOrg?: boolean | { orgId: string; role: 'USER' | 'ADMIN'; id: string }
  ) {
    if (provider === Provider.LOCAL) {
      if (process.env.DISALLOW_PLUS && body.email.includes('+')) {
        throw new Error('Email with plus sign is not allowed');
      }
      if (body instanceof CreateOrgUserDto) {
        body.email = body.email.toLowerCase();
      }
      const user = await this._userService.getUserByEmail(body.email);
      if (body instanceof CreateOrgUserDto) {
        if (user) {
          throw new Error('Email already exists');
        }

        const invite =
          addToOrg && typeof addToOrg !== 'boolean' ? addToOrg : null;

        // Invited users may register even when public registration is disabled
        // (invite-only model: no open signups, but invitees can still join).
        if (!invite && !(await this.canRegister(provider))) {
          throw new Error('Registration is disabled');
        }

        let newUser: User;
        let addedOrg: any = false;
        if (invite) {
          // Invited user: create the account with NO personal org and join the
          // inviting org. Fall back to a personal org only if the invite can't
          // be honoured, so the account is never orphaned.
          newUser = await this._organizationService.createUser(
            body,
            ip,
            userAgent
          );
          addedOrg = await this._organizationService.addUserToOrg(
            newUser.id,
            invite.id,
            invite.orgId,
            invite.role
          );
          if (!addedOrg) {
            await this._organizationService.createOrgForUser(
              newUser.id,
              body.company
            );
          }
        } else {
          const create = await this._organizationService.createOrgAndUser(
            body,
            ip,
            userAgent
          );
          newUser = create.users[0].user;
        }

        const obj = { addedOrg, jwt: await this.jwt(newUser) };
        await this._emailService.sendEmail(
          body.email,
          'Activate your account',
          `Click <a href="${process.env.FRONTEND_URL}/auth/activate/${obj.jwt}">here</a> to activate your account`,
          'top'
        );
        return obj;
      }

      if (!user || !AuthChecker.comparePassword(body.password, user.password)) {
        throw new Error('Invalid user name or password');
      }

      if (!user.activated) {
        throw new Error('User is not activated');
      }

      return { addedOrg: false, jwt: await this.jwt(user) };
    }

    const invite =
      addToOrg && typeof addToOrg !== 'boolean' ? addToOrg : null;
    const { user, addedOrg: providerAddedOrg } =
      await this.loginOrRegisterProvider(
        provider,
        body as CreateOrgUserDto,
        ip,
        userAgent,
        invite
      );

    // A NEW provider user is already joined inside the helper (providerAddedOrg
    // is a row or false); only an EXISTING provider user returns undefined and
    // needs the invite join applied here (unchanged from before).
    const addedOrg =
      providerAddedOrg !== undefined
        ? providerAddedOrg
        : invite
        ? await this._organizationService.addUserToOrg(
            user.id,
            invite.id,
            invite.orgId,
            invite.role
          )
        : false;
    return { addedOrg, jwt: await this.jwt(user) };
  }

  public getOrgFromCookie(cookie?: string) {
    if (!cookie) {
      return false;
    }

    try {
      const getOrg: any = AuthChecker.verifyJWT(cookie);
      if (dayjs(getOrg.timeLimit).isBefore(dayjs())) {
        return false;
      }

      return getOrg as {
        email: string;
        role: 'USER' | 'ADMIN';
        orgId: string;
        id: string;
      };
    } catch (err) {
      return false;
    }
  }

  private async loginOrRegisterProvider(
    provider: Provider,
    body: CreateOrgUserDto,
    ip: string,
    userAgent: string,
    invite?: { orgId: string; role: 'USER' | 'ADMIN'; id: string } | null
  ): Promise<{ user: User; addedOrg: any }> {
    const providerInstance = this._providerManager.getProvider(provider);
    const providerUser = await providerInstance.getUser(body.providerToken);

    if (!providerUser) {
      throw new Error('Invalid provider token');
    }

    const user = await this._userService.getUserByProvider(
      providerUser.id,
      provider
    );
    if (user) {
      // Existing provider user: caller applies any invite join (unchanged).
      return { user, addedOrg: undefined as any };
    }

    // Invited users may register even when public registration is disabled.
    if (!invite && !(await this.canRegister(provider))) {
      throw new Error('Registration is disabled');
    }

    const orgUserBody = {
      company: body.company,
      email: providerUser.email,
      password: '',
      provider,
      providerId: providerUser.id,
      datafast_visitor_id: body.datafast_visitor_id,
    };
    let created: User;
    let addedOrg: any = undefined;
    let orgIdForPostRegistration: string | undefined;
    if (invite) {
      // Invited new provider user: no personal org, join the inviting org
      // (orphan-safe fallback to a personal org if the invite can't be honoured).
      created = await this._organizationService.createUser(
        orgUserBody,
        ip,
        userAgent
      );
      addedOrg = await this._organizationService.addUserToOrg(
        created.id,
        invite.id,
        invite.orgId,
        invite.role
      );
      if (!addedOrg) {
        const org = await this._organizationService.createOrgForUser(
          created.id,
          body.company
        );
        orgIdForPostRegistration = org.id;
      } else {
        orgIdForPostRegistration = invite.orgId;
      }
    } else {
      const create = await this._organizationService.createOrgAndUser(
        orgUserBody,
        ip,
        userAgent
      );
      created = create.users[0].user;
      orgIdForPostRegistration = create.id;
    }

    this._track('register', providerUser.email, body.datafast_visitor_id).catch(
      (err) => {}
    );

    await NewsletterService.register(providerUser.email);

    try {
      if (providerInstance?.postRegistration) {
        await providerInstance.postRegistration(
          body.providerToken,
          orgIdForPostRegistration!
        );
      }
    } catch (err) {
      // Don't fail registration if postRegistration fails
    }

    return { user: created, addedOrg };
  }

  private async _track(
    name: string,
    email: string,
    datafast_visitor_id: string
  ) {
    if (email && datafast_visitor_id && process.env.DATAFAST_API_KEY) {
      try {
        await fetch('https://datafa.st/api/v1/goals', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.DATAFAST_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            datafast_visitor_id: datafast_visitor_id,
            name: name,
            metadata: {
              email,
            },
          }),
        });
      } catch (err) {}
    }
  }

  async forgot(email: string) {
    const user = await this._userService.getUserByEmail(email);
    if (!user || user.providerName !== Provider.LOCAL) {
      return false;
    }

    const resetValues = AuthChecker.signJWT({
      id: user.id,
      expires: dayjs().add(20, 'minutes').format('YYYY-MM-DD HH:mm:ss'),
    });

    await this._notificationService.sendEmail(
      user.email,
      'Reset your password',
      `You have requested to reset your passsord. <br />Click <a href="${process.env.FRONTEND_URL}/auth/forgot/${resetValues}">here</a> to reset your password<br />The link will expire in 20 minutes`
    );
  }

  forgotReturn(body: ForgotReturnPasswordDto) {
    const user = AuthChecker.verifyJWT(body.token) as {
      id: string;
      expires: string;
    };
    if (dayjs(user.expires).isBefore(dayjs())) {
      return false;
    }

    return this._userService.updatePassword(user.id, body.password);
  }

  async activate(code: string, tracking: string) {
    const user = AuthChecker.verifyJWT(code) as {
      id: string;
      activated: boolean;
      email: string;
    };
    if (user.id && !user.activated) {
      const getUserAgain = await this._userService.getUserByEmail(user.email);
      if (getUserAgain.activated) {
        return false;
      }
      await this._userService.activateUser(user.id);
      user.activated = true;
      this._track('register', user.email, tracking).catch((err) => {});
      await NewsletterService.register(user.email);
      return this.jwt(user as any);
    }

    return false;
  }

  async resendActivationEmail(email: string) {
    const user = await this._userService.getUserByEmail(email);

    if (!user) {
      throw new Error('User not found');
    }

    if (user.activated) {
      throw new Error('Account is already activated');
    }

    const jwt = await this.jwt(user);

    await this._emailService.sendEmail(
      user.email,
      'Activate your account',
      `Click <a href="${process.env.FRONTEND_URL}/auth/activate/${jwt}">here</a> to activate your account`,
      'top'
    );

    return true;
  }

  oauthLink(provider: string, query?: any) {
    const providerInstance = this._providerManager.getProvider(provider);
    return providerInstance.generateLink(query);
  }

  async checkExists(provider: string, code: string, redirectUri?: string) {
    const providerInstance = this._providerManager.getProvider(provider);
    const token = await providerInstance.getToken(code, redirectUri);
    const user = await providerInstance.getUser(token);
    if (!user) {
      throw new Error('Invalid user');
    }
    const checkExists = await this._userService.getUserByProvider(
      user.id,
      provider as Provider
    );
    if (checkExists) {
      return { jwt: await this.jwt(checkExists) };
    }

    return { token };
  }

  private async jwt(user: User) {
    if (user.password) {
      delete user.password;
    }
    return AuthChecker.signJWT(user);
  }
}

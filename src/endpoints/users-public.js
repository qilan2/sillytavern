import crypto from 'node:crypto';

import storage from 'node-persist';
import express from 'express';
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';
import { jsonParser, getIpFromRequest } from '../express-common.js';
import { color, Cache, getConfigValue } from '../util.js';
import {
    KEY_PREFIX,
    getUserAvatar,
    toKey,
    getPasswordHash,
    getPasswordSalt,
    getAllUserHandles,
    getUserDirectories,
    ensurePublicDirectoriesExist,
} from '../users.js';
import lodash from 'lodash';
import { checkForNewContent } from './content-manager.js';

const DISCREET_LOGIN = false;
const MFA_CACHE = new Cache(5 * 60 * 1000);

export const router = express.Router();
const loginLimiter = new RateLimiterMemory({
    points: 5,
    duration: 60,
});
const recoverLimiter = new RateLimiterMemory({
    points: 5,
    duration: 300,
});

router.post('/list', async (_request, response) => {
    try {
        if (DISCREET_LOGIN) {
            console.log('Discreet login mode is enabled, returning 204');
            return response.sendStatus(204);
        }

        // 获取所有用户数量
        const users = await storage.values(x => x.key.startsWith(KEY_PREFIX));
        const enabledUsers = users.filter(user => user.enabled);

        // 只返回数量信息
        return response.json({
            total: users.length,
            enabled: enabledUsers.length
        });
    } catch (error) {
        console.error('User list failed:', error);
        return response.sendStatus(500);
    }
});

router.get('/ip-info', async (_request, response) => {
    try {
        // 添加超时和重试选项
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒超时

        const geoResponse = await fetch('https://qifu-api.baidubce.com/ip/geo/v1/district', {
            signal: controller.signal,
            headers: {
                'Accept': 'application/json'
            }
        });

        clearTimeout(timeoutId);

        if (!geoResponse.ok) {
            throw new Error(`HTTP error! status: ${geoResponse.status}`);
        }

        const text = await geoResponse.text(); // 先获取响应文本
        if (!text) {
            throw new Error('Empty response from API');
        }

        const geoData = JSON.parse(text); // 尝试解析 JSON
        return response.json(geoData);
    } catch (error) {
        console.error('获取IP信息失败:', error);
        // 返回一个友好的错误响应
        return response.status(200).json({ 
            code: 'Error',
            message: error.message || '获取IP信息失败',
            data: {
                prov: '未知',
                city: '未知',
                district: '',
                isp: '未知'
            }
        });
    }
});

router.post('/login', jsonParser, async (request, response) => {
    try {
        if (!request.body.handle) {
            console.log('Login failed: Missing required fields');
            return response.status(400).json({ error: 'Missing required fields' });
        }

        const ip = getIpFromRequest(request);
        await loginLimiter.consume(ip);

        /** @type {import('../users.js').User} */
        const user = await storage.getItem(toKey(request.body.handle));

        if (!user) {
            console.log('Login failed: User not found');
            return response.status(403).json({ error: 'Incorrect credentials' });
        }

        if (!user.enabled) {
            console.log('Login failed: User is disabled');
            return response.status(403).json({ error: 'User is disabled' });
        }

        if (user.password && user.password !== getPasswordHash(request.body.password, user.salt)) {
            console.log('Login failed: Incorrect password');
            return response.status(403).json({ error: 'Incorrect credentials' });
        }

        if (!request.session) {
            console.error('Session not available');
            return response.sendStatus(500);
        }

        await loginLimiter.delete(ip);
        request.session.handle = user.handle;
        console.log('Login successful:', user.handle, request.session);
        return response.json({ handle: user.handle });
    } catch (error) {
        if (error instanceof RateLimiterRes) {
            console.log('Login failed: Rate limited from', getIpFromRequest(request));
            return response.status(429).send({ error: 'Too many attempts. Try again later or recover your password.' });
        }

        console.error('Login failed:', error);
        return response.sendStatus(500);
    }
});

router.post('/recover-step1', jsonParser, async (request, response) => {
    try {
        if (!request.body.handle) {
            console.log('Recover step 1 failed: Missing required fields');
            return response.status(400).json({ error: 'Missing required fields' });
        }

        const ip = getIpFromRequest(request);
        await recoverLimiter.consume(ip);

        /** @type {import('../users.js').User} */
        const user = await storage.getItem(toKey(request.body.handle));

        if (!user) {
            console.log('Recover step 1 failed: User not found');
            return response.status(404).json({ error: 'User not found' });
        }

        if (!user.enabled) {
            console.log('Recover step 1 failed: User is disabled');
            return response.status(403).json({ error: 'User is disabled' });
        }

        const mfaCode = String(crypto.randomInt(1000, 9999));
        console.log();
        console.log(color.blue(`${user.name}, your password recovery code is: `) + color.magenta(mfaCode));
        console.log();
        MFA_CACHE.set(user.handle, mfaCode);
        return response.sendStatus(204);
    } catch (error) {
        if (error instanceof RateLimiterRes) {
            console.log('Recover step 1 failed: Rate limited from', getIpFromRequest(request));
            return response.status(429).send({ error: 'Too many attempts. Try again later or contact your admin.' });
        }

        console.error('Recover step 1 failed:', error);
        return response.sendStatus(500);
    }
});

router.post('/recover-step2', jsonParser, async (request, response) => {
    try {
        if (!request.body.handle || !request.body.code) {
            console.log('Recover step 2 failed: Missing required fields');
            return response.status(400).json({ error: 'Missing required fields' });
        }

        /** @type {import('../users.js').User} */
        const user = await storage.getItem(toKey(request.body.handle));
        const ip = getIpFromRequest(request);

        if (!user) {
            console.log('Recover step 2 failed: User not found');
            return response.status(404).json({ error: 'User not found' });
        }

        if (!user.enabled) {
            console.log('Recover step 2 failed: User is disabled');
            return response.status(403).json({ error: 'User is disabled' });
        }

        const mfaCode = MFA_CACHE.get(user.handle);

        if (request.body.code !== mfaCode) {
            await recoverLimiter.consume(ip);
            console.log('Recover step 2 failed: Incorrect code');
            return response.status(403).json({ error: 'Incorrect code' });
        }

        if (request.body.newPassword) {
            const salt = getPasswordSalt();
            user.password = getPasswordHash(request.body.newPassword, salt);
            user.salt = salt;
            await storage.setItem(toKey(user.handle), user);
        } else {
            user.password = '';
            user.salt = '';
            await storage.setItem(toKey(user.handle), user);
        }

        await recoverLimiter.delete(ip);
        MFA_CACHE.remove(user.handle);
        return response.sendStatus(204);
    } catch (error) {
        if (error instanceof RateLimiterRes) {
            console.log('Recover step 2 failed: Rate limited from', getIpFromRequest(request));
            return response.status(429).send({ error: 'Too many attempts. Try again later or contact your admin.' });
        }

        console.error('Recover step 2 failed:', error);
        return response.sendStatus(500);
    }
});

router.post('/create', jsonParser, async (request, response) => {
    try {
        if (!request.body.handle || !request.body.name) {
            console.log('Create user failed: Missing required fields');
            return response.status(400).json({ error: 'Missing required fields' });
        }

        // 检查是否是第一个用户
        const handles = await getAllUserHandles();
        const isFirstUser = handles.length === 0;

        const handle = lodash.kebabCase(String(request.body.handle).toLowerCase().trim());

        if (!handle) {
            console.log('Create user failed: Invalid handle');
            return response.status(400).json({ error: 'Invalid handle' });
        }

        if (handles.some(x => x === handle)) {
            console.log('Create user failed: User with that handle already exists');
            return response.status(409).json({ error: 'User already exists' });
        }

        const salt = getPasswordSalt();
        const password = request.body.password ? getPasswordHash(request.body.password, salt) : '';

        const newUser = {
            handle: handle,
            name: request.body.name || 'Anonymous',
            created: Date.now(),
            password: password,
            salt: salt,
            admin: isFirstUser, // 只有第一个用户是管理员
            enabled: true,
        };

        await storage.setItem(toKey(handle), newUser);

        // Create user directories
        console.log('Creating data directories for', newUser.handle);
        await ensurePublicDirectoriesExist();
        const directories = getUserDirectories(newUser.handle);
        await checkForNewContent([directories]);
        return response.json({ handle: newUser.handle });
    } catch (error) {
        console.error('User create failed:', error);
        return response.sendStatus(500);
    }
});

router.get('/count', async (_request, response) => {
    try {
        if (DISCREET_LOGIN) {
            return response.sendStatus(204);
        }

        /** @type {import('../users.js').User[]} */
        const users = await storage.values(x => x.key.startsWith(KEY_PREFIX));
        const enabledUsers = users.filter(user => user.enabled);

        return response.json({
            total: users.length,
            enabled: enabledUsers.length
        });
    } catch (error) {
        console.error('Get user count failed:', error);
        return response.sendStatus(500);
    }
});

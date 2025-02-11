//login.js   users-admin.js
//login.js   users-admin.js
//A:\1sillytavern\SillyTavern\public\scripts\user.js
//A:\1sillytavern\SillyTavern\src\endpoints\users-admin.js
//A:\1sillytavern\SillyTavern\public\scripts\templates\admin.html
//A:\1sillytavern\SillyTavern\public\css\user.css





/**
node post-install.js
rm -r data/_cache/* && rm -r data/_storage/*
 */
let csrfToken = '';
let discreetLogin = false;

/**
 * Gets a CSRF token from the server.
 * @returns {Promise<string>} CSRF token
 */
async function getCsrfToken() {
    const response = await fetch('/csrf-token');
    const data = await response.json();
    return data.token;
}

/**
 * Gets a list of users from the server.
 * @returns {Promise<object>} List of users
 */
async function getUserList() {
    const response = await fetch('/api/users/list', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
        },
    });

    if (!response.ok) {
        const errorData = await response.json();
        return displayError(errorData.error || 'An error occurred');
    }

    if (response.status === 204) {
        discreetLogin = true;
        return [];
    }

    const userListObj = await response.json();
    console.log('获取到的用户列表:', userListObj);
    return userListObj;
}

/**
 * Requests a recovery code for the user.
 * @param {string} handle User handle
 * @returns {Promise<void>}
 */
async function sendRecoveryPart1(handle) {
    const response = await fetch('/api/users/recover-step1', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({ handle }),
    });

    if (!response.ok) {
        const errorData = await response.json();
        return displayError(errorData.error || 'An error occurred');
    }

    showRecoveryBlock();
}

/**
 * Sets a new password for the user using the recovery code.
 * @param {string} handle User handle
 * @param {string} code Recovery code
 * @param {string} newPassword New password
 * @returns {Promise<void>}
 */
async function sendRecoveryPart2(handle, code, newPassword) {
    const recoveryData = {
        handle,
        code,
        newPassword,
    };

    const response = await fetch('/api/users/recover-step2', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify(recoveryData),
    });

    if (!response.ok) {
        const errorData = await response.json();
        return displayError(errorData.error || 'An error occurred');
    }

    console.log(`Successfully recovered password for ${handle}!`);
    await performLogin(handle, newPassword);
}

/**
 * Attempts to log in the user.
 * @param {string} handle User's handle
 * @param {string} password User's password
 * @returns {Promise<void>}
 */
async function performLogin(handle, password) {
    const userInfo = {
        handle: handle,
        password: password,
    };

    try {
        const response = await fetch('/api/users/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken,
                },
            body: JSON.stringify(userInfo),
        });

        if (!response.ok) {
            const errorData = await response.json();
            return displayError(errorData.error || 'An error occurred');
        }

        const data = await response.json();

        if (data.handle) {
            console.log(`Successfully logged in as ${handle}!`);
            redirectToHome();
        }
    } catch (error) {
        console.error('Error logging in:', error);
        displayError(String(error));
    }
}

/**
 * Handles the user selection event.
 * @param {object} user User object
 * @returns {Promise<void>}
 */
async function onUserSelected(user) {
    // No password, just log in
    if (!user.password) {
        return await performLogin(user.handle, '');
    }

    $('#passwordRecoveryBlock').hide();
    $('#passwordEntryBlock').show();
    $('#loginButton').off('click').on('click', async () => {
        const password = String($('#userPassword').val());
        await performLogin(user.handle, password);
    });

    $('#recoverPassword').off('click').on('click', async () => {
        await sendRecoveryPart1(user.handle);
    });

    $('#sendRecovery').off('click').on('click', async () => {
        const code = String($('#recoveryCode').val());
        const newPassword = String($('#newPassword').val());
        await sendRecoveryPart2(user.handle, code, newPassword);
    });

    displayError('');
}

/**
 * Displays an error message to the user.
 * @param {string} message Error message
 */
function displayError(message) {
    // 错误消息翻译
    const errorMessages = {
        'User already exists': '用户已经存在',
        'Missing required fields': '请填写所有必填字段',
        'Invalid handle': '用户名格式不正确',
        'User not found': '用户不存在',
        'User is disabled': '用户已被禁用',
        'Incorrect credentials': '用户名或密码错误',
        'Too many attempts. Try again later or recover your password.': '尝试次数过多，请稍后再试或找回密码',
        'Too many attempts. Try again later or contact your admin.': '尝试次数过多，请稍后再试或联系管理员',
        'An error occurred': '发生错误',
    };

    const translatedMessage = errorMessages[message] || message;
    $('#errorMessage').text(translatedMessage);
}

/**
 * Redirects the user to the home page.
 * Preserves the query string.
 */
function redirectToHome() {
    // After a login theres no need to preserve the
    // noauto (if present)
    const urlParams = new URLSearchParams(window.location.search);

    urlParams.delete('noauto');

    window.location.href = '/' + urlParams.toString();
}

/**
 * Hides the password entry block and shows the password recovery block.
 */
function showRecoveryBlock() {
    $('#passwordEntryBlock').hide();
    $('#passwordRecoveryBlock').show();
    displayError('');
}

/**
 * Hides the password recovery block and shows the password entry block.
 */
function onCancelRecoveryClick() {
    $('#passwordRecoveryBlock').hide();
    $('#passwordEntryBlock').show();
    displayError('');
}

/**
 * Configure the login form for normal login mode
 */
function configureNormalLogin() {
    console.log('Discreet login is disabled');
    $('#handleEntryBlock').show();
    $('#normalLoginPrompt').show();
    $('#discreetLoginPrompt').hide();
    $('#userList').hide();
    $('#passwordRecoveryBlock').hide();
    $('#passwordEntryBlock').show();
    $('#loginButton').off('click').on('click', async () => {
        const handle = String($('#userHandle').val());
        const password = String($('#userPassword').val());
        await performLogin(handle, password);
    });
}

/**
 * Configures the login page for discreet login.
 */
function configureDiscreetLogin() {
    console.log('Discreet login is enabled');
    $('#handleEntryBlock').show();
    $('#normalLoginPrompt').hide();
    $('#discreetLoginPrompt').show();
    $('#userList').hide();
    $('#passwordRecoveryBlock').hide();
    $('#passwordEntryBlock').show();
    $('#loginButton').off('click').on('click', async () => {
        const handle = String($('#userHandle').val());
        const password = String($('#userPassword').val());
        await performLogin(handle, password);
    });

    $('#recoverPassword').off('click').on('click', async () => {
        const handle = String($('#userHandle').val());
        await sendRecoveryPart1(handle);
    });

    $('#sendRecovery').off('click').on('click', async () => {
        const handle = String($('#userHandle').val());
        const code = String($('#recoveryCode').val());
        const newPassword = String($('#newPassword').val());
        await sendRecoveryPart2(handle, code, newPassword);
    });
}

// 修改检查首次用户的函数
async function checkFirstUser() {
    try {
        const response = await fetch('/api/users/list', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken,
            }
        });
        
        // 如果返回204(隐私模式)或返回空数组,都认为是首次使用
        if (response.status === 204) {
            return true; // 允许创建用户
        }
        
        if (response.ok) {
            const users = await response.json();
            return users.length === 0; // 如果没有用户返回true
        }

        return true; // 其他情况也允许创建用户
    } catch (error) {
        console.error('检查首次用户失败:', error);
        return true; // 出错时也允许创建用户
    }
}

// 修改访客创建用户的函数
async function guestCreateUser(handle, password) {
    try {
        // 直接创建用户，不需要先登录
        const createResponse = await fetch('/api/users/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken,
            },
            body: JSON.stringify({
                handle: handle,
                password: password,
                name: handle
            })
        });

        // 处理创建用户的响应
        if (!createResponse.ok) {
            // 特别处理409冲突状态码
            if (createResponse.status === 409) {
                throw new Error('用户已经存在');
            }
            
            // 处理其他错误
            try {
                const data = await createResponse.json();
                // 将文错误信息转换为中文
                const errorMap = {
                    'Missing required fields': '请填写所有必填字段',
                    'Invalid handle': '用户名格式不正确',
                    'User not found': '用户不存在',
                    'User is disabled': '用户已被禁用'
                };
                const errorMessage = errorMap[data.error] || data.error || '注册失败';
                throw new Error(errorMessage);
            } catch (e) {
                throw new Error(createResponse.statusText || '注册失败');
            }
        }

        const data = await createResponse.json();
        if (data.handle !== handle) {
            throw new Error('注册失败: 用户名不匹配');
        }

        return true;
    } catch (error) {
        console.error('注册失败:', error);
        throw error;
    }
}

// 获取所有用户数量
async function getAllUsersCount() {
    try {
        const response = await fetch('/api/users/count', {
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken,
            }
        });

        if (!response.ok) {
            console.error('获取用户数量失败');
            return null;
        }

        if (response.status === 204) {
            return { total: 0, enabled: 0 };
        }

        return await response.json();
    } catch (error) {
        console.error('获取用户数量失败:', error);
        return null;
    }
}

// 设置随机背景图片
function setRandomBackground() {
    const apiImgPath = 'img/apiimg/';
    const bgImages = [
        '1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg',
        '6.jpg', '7.jpg', '8.jpg', '9.jpg', '10.jpg',
        '11.jpg', '12.jpg', '13.jpg', '14.jpg', '15.jpg',
        '16.jpg', '17.jpg', '18.jpg', '19.jpg', '20.jpg', '21.jpg'
    ];
    
    const randomIndex = Math.floor(Math.random() * bgImages.length);
    const selectedImage = bgImages[randomIndex];
    const imageUrl = apiImgPath + selectedImage;
    
    document.body.style.backgroundImage = `url('${imageUrl}')`;
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundPosition = 'center';
    document.body.style.backgroundRepeat = 'no-repeat';
    document.body.style.backgroundAttachment = 'fixed';
}

(async function () {
    csrfToken = await getCsrfToken();
    // 设置随机背景
    setRandomBackground();
    
    const userCount = await getAllUsersCount();

    if (!userCount) {
        $('#userCount').text('获取用户数量失败');
        return;
    }

    if (userCount.total === 0) {
        $('#userCount').text('暂无用户');
    } else {
        $('#userCount').text(`总用户数[${userCount.total}]`);
    }

    const response = await fetch('/api/users/list', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
        },
    });

    if (!response.ok) {
        console.error('获取用户数量失败');
        return;
    }

    if (response.status === 204) {
        $('#userCount').text('隐私模式已启用');
        return;
    }

    const data = await response.json();
    $('#userCount').text(`总用户数[${data.total}]`);

    if (discreetLogin) {
        configureDiscreetLogin();
    } else {
        configureNormalLogin();
    }
    document.getElementById('shadow_popup').style.opacity = '';
    $('#cancelRecovery').on('click', onCancelRecoveryClick);
    $(document).on('keydown', (evt) => {
        if (evt.key === 'Enter' && document.activeElement.tagName === 'INPUT') {
            if ($('#passwordRecoveryBlock').is(':visible')) {
                $('#sendRecovery').trigger('click');
            } else {
                $('#loginButton').trigger('click');
            }
        }
    });

    // 显示注册界面
    $('#showRegister').on('click', async function() {
        // 直接显示注册界面,不做检查
        $('#userListBlock').children().hide();
        $('#registerBlock').show();
    });

    // 返回登录界面
    $('#backToLogin').on('click', function() {
        $('#registerBlock').hide();
        $('#passwordRecoveryBlock').hide();
        $('#passwordEntryBlock').show();
        $('#userListBlock').children().not('#registerBlock, #passwordRecoveryBlock').show();
        $('#errorMessage').text('');
    });

    // 修改注册按钮的处理函数
    $('#registerButton').on('click', async function() {
        const handle = $('#registerHandle').val();
        const password = $('#registerPassword').val();
        const confirm = $('#registerConfirm').val();

        if (!handle || !password) {
            $('#errorMessage').text('请填写所有字段');
            return;
        }

        // 验证用户名格式：只能是数字，长度6-13位
        if (!/^\d{6,13}$/.test(handle)) {
            $('#errorMessage').text('用户名只能是6-13位的数字');
            return;
        }

        if (password !== confirm) {
            $('#errorMessage').text('两次输入的密码不一致');
            return;
        }

        try {
            await guestCreateUser(handle, password);
            $('#errorMessage').text('注册成功!请登录').css('color', 'green');
            
            // 延迟返回登录界面,让用户能看到成功提示
            setTimeout(() => {
                $('#backToLogin').click();
                $('#errorMessage').text('').css('color', '');
                
                // 刷新用户列表
                location.reload();
            }, 1500);
            
        } catch (error) {
            $('#errorMessage').text(error.message);
        }
    });
})();
